// Schema extraction utilities shared by the schema-sync guard.
//
// The source of truth for the production D1 schema is the concatenation of
// migrations/*.sql (applied in filename order). The integration tests in
// tests/app.test.ts inline a mirror of that schema as a string (the
// vitest-pool-workers bundler cannot read migrations from disk), and that
// mirror MUST stay in sync or the tests silently stop reflecting production.
//
// These helpers parse a SQL blob into a normalized shape — per table, the set
// of columns — replaying `ALTER TABLE ... ADD COLUMN` so the comparison is
// against the FINAL column set, not the literal CREATE statement text. Format
// differences (spacing, default values, comments, trailing commas, FK lines)
// do not affect the comparison, only the column *names* per table matter.

export interface TableColumns {
  columns: Set<string>;
}

export type SchemaModel = Map<string, TableColumns>;

// Strip SQL line + inline comments so they never affect parsing.
function stripComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ") // line comments
    .replace(/\/\*[\s\S]*?\*\//g, " "); // block comments
}

// Parse a SQL blob into a normalized schema model.
// Handles: CREATE TABLE [IF NOT EXISTS] name (...), ALTER TABLE name ADD COLUMN col ...
export function parseSchema(sql: string): SchemaModel {
  const clean = stripComments(sql);
  const model: SchemaModel = new Map();

  // 1) CREATE TABLE statements.
  const createRe =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?([A-Za-z_][\w]*)[`"]?\s*\(([\s\S]*?)\)\s*;/gi;
  let m: RegExpExecArray | null;
  while ((m = createRe.exec(clean)) !== null) {
    const name = m[1].toLowerCase();
    const body = m[2];
    const cols = extractColumns(body);
    model.set(name, { columns: cols });
  }

  // 2) ALTER TABLE ... ADD COLUMN (may appear after the CREATE, in migrations).
  const alterRe =
    /ALTER\s+TABLE\s+[`"]?([A-Za-z_][\w]*)[`"]?\s+ADD\s+COLUMN\s+[`"]?([A-Za-z_][\w]*)/gi;
  while ((m = alterRe.exec(clean)) !== null) {
    const name = m[1].toLowerCase();
    const col = m[2].toLowerCase();
    const entry = model.get(name) ?? { columns: new Set<string>() };
    entry.columns.add(col);
    model.set(name, entry);
  }

  return model;
}

// Pull column names out of a CREATE TABLE body. We split on commas that are
// NOT inside parentheses, then take the first token of each segment that is a
// valid identifier and not a constraint keyword (PRIMARY KEY / FOREIGN KEY /
// UNIQUE / CHECK / CONSTRAINT).
function extractColumns(body: string): Set<string> {
  const cols = new Set<string>();
  const segments = splitTopLevel(body);
  const constraintKw = new Set([
    "primary",
    "foreign",
    "unique",
    "check",
    "constraint",
    "key",
  ]);
  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed) continue;
    const firstWord = trimmed.split(/\s+/)[0].replace(/[`"]/g, "").toLowerCase();
    if (!firstWord || constraintKw.has(firstWord)) continue;
    if (!/^[a-z_][\w]*$/.test(firstWord)) continue;
    cols.add(firstWord);
  }
  return cols;
}

// Split on commas that are at paren-depth 0.
function splitTopLevel(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// Compare two schema models given as Record<string, string[]>. Used by the
// in-worker test, which compares the committed fixtures (generated from
// migrations/ and the inline schemaSql) rather than reading disk at runtime.
export function diffSchemasFromRecords(
  migrations: Record<string, string[]>,
  inline: Record<string, string[]>
): string[] {
  const diffs: string[] = [];
  const allTables = new Set([...Object.keys(migrations), ...Object.keys(inline)]);
  for (const table of allTables) {
    const mCols = migrations[table];
    const iCols = inline[table];
    if (!mCols) {
      diffs.push(`Table "${table}" exists in the inline test schema but NOT in migrations.`);
      continue;
    }
    if (!iCols) {
      diffs.push(`Table "${table}" exists in migrations but NOT in the inline test schema.`);
      continue;
    }
    const missing = mCols.filter((c) => !iCols.includes(c)).sort();
    const extra = iCols.filter((c) => !mCols.includes(c)).sort();
    if (missing.length) {
      diffs.push(`Table "${table}": migrations has columns missing from inline test schema: ${missing.join(", ")}.`);
    }
    if (extra.length) {
      diffs.push(`Table "${table}": inline test schema has columns missing from migrations: ${extra.join(", ")}.`);
    }
  }
  return diffs;
}
