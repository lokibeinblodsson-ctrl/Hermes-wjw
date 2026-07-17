// Daily business-continuity backup.
//
// This is NOT a convenience export — it is the automated nightly snapshot that
// lets the practice recover from accidental data loss or a bad restore. It
// dumps the full DB, writes a versioned + checksummed JSON object to Backblaze
// B2 (S3-compatible), and records the outcome in audit_logs.
//
// Triggered by Cloudflare Cron Triggers (see `[[triggers.crons]]` in
// wrangler.toml -> `scheduled` handler in src/index.ts). Safe to call manually.
//
// Behavior:
//   - No-ops (returns early) if B2 is not configured or not in production, so a
//     local `wrangler dev` / CI never tries to hit B2.
//   - On any B2 failure, logs a `backup_failed` audit event AND throws — Cron
//     Triggers surface throwns to the dashboard, so an unattended backup that
//     silently failed to land in B2 will not go unnoticed.
import { Env, IS_PRODUCTION } from "./env";
import { s3Put } from "./storage";
import { logAudit } from "../db/logging";
import {
  APP_NAME,
  APP_VERSION,
  BACKUP_SCHEMA_VERSION,
  cardsChecksum,
} from "./appMeta";
import { nowIso } from "./crypto";

// Tables included in the nightly snapshot, in dependency order. Audit logs and
// analytics are included so a restore returns the full operational history.
const TABLES = [
  "users",
  "categories",
  "board_columns",
  "cards",
  "tasks",
  "task_history",
  "channels",
  "messages",
  "comments",
  "sources",
  "files",
  "docs",
  "memory_notes",
  "feature_flags",
  "settings",
  "audit_logs",
  "analytics_events",
] as const;

type Row = Record<string, unknown>;

async function dumpTable(db: Env["DB"], table: string): Promise<Row[]> {
  const rs = await db.prepare(`SELECT * FROM ${table}`).all();
  return ((rs.results as Row[]) || []).map((r) => {
    // JSON columns are stored as TEXT; keep them as the original JSON string so
    // the snapshot is a faithful, re-importable copy.
    const out: Row = {};
    for (const [k, v] of Object.entries(r)) out[k] = v;
    return out;
  });
}

export interface DailyBackupResult {
  objectKey: string;
  cardCount: number;
  rowCount: number;
  checksum: string;
}

export async function runDailyBackup(env: Env): Promise<DailyBackupResult> {
  if (!IS_PRODUCTION(env)) {
    console.log("[backup] skipped: not production");
    return { objectKey: "", cardCount: 0, rowCount: 0, checksum: "" };
  }
  if (!(env.B2_KEY_ID && env.B2_APP_KEY && env.B2_BUCKET_NAME)) {
    console.warn("[backup] skipped: B2 not configured");
    return { objectKey: "", cardCount: 0, rowCount: 0, checksum: "" };
  }

  const snapshot: Record<string, unknown> = {
    app_name: APP_NAME,
    version: APP_VERSION,
    schema_version: BACKUP_SCHEMA_VERSION,
    kind: "daily-snapshot",
    timestamp: nowIso(),
  };
  let rowCount = 0;
  const tables: Record<string, Row[]> = {};
  for (const t of TABLES) {
    const rows = await dumpTable(env.DB, t);
    tables[t] = rows;
    rowCount += rows.length;
  }
  snapshot.tables = tables;

  const cards = (tables["cards"] || []) as Row[];
  snapshot.card_count = cards.length;
  snapshot.checksum = await cardsChecksum(cards as any[]);
  snapshot.manual =
    "Automated daily snapshot written by Cron Triggers. Restore via the admin Data tab or `wrangler` + a manual import of this object.";

  const body = new TextEncoder().encode(JSON.stringify(snapshot));
  const day = nowIso().slice(0, 10); // YYYY-MM-DD
  const objectKey = `backups/daily/${day}.json`;

  try {
    const url = await s3Put({
      endpoint:
        (env.B2_PUBLIC_URL || "").replace(/\/[^/]*$/, "") ||
        "https://s3.us-west-004.backblazeb2.com",
      bucket: env.B2_BUCKET_NAME,
      key: objectKey,
      body: body as unknown as Uint8Array,
      contentType: "application/json",
      accessKeyId: env.B2_KEY_ID,
      secretAccessKey: env.B2_APP_KEY,
    });
    await logAudit(env.DB, {
      actorId: "system",
      action: "backup_exported",
      targetType: "backup",
      targetId: objectKey,
      meta: { kind: "daily-snapshot", card_count: cards.length, row_count: rowCount, url },
    });
    console.log(`[backup] wrote ${objectKey} (${rowCount} rows, ${cards.length} cards)`);
    return { objectKey, cardCount: cards.length, rowCount, checksum: snapshot.checksum as string };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logAudit(env.DB, {
      actorId: "system",
      action: "backup_failed",
      targetType: "backup",
      targetId: objectKey,
      meta: { error: message },
    });
    // Throw so the Cron Trigger run is marked failed in the Cloudflare dashboard.
    throw new Error(`Daily backup to B2 failed: ${message}`);
  }
}
