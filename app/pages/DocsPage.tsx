// Auto-updating in-app docs page (route /docs). Pulls live data from the
// backend on every load and offers "Copy all as Markdown".
import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";

export default function DocsPage() {
  const [doc, setDoc] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/docs");
      setDoc(res.data);
      setError("");
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="muted">Loading docs…</div>;
  if (error) return <div className="error">{error}</div>;
  if (!doc) return null;

  const d = doc.data;
  const md = toMarkdown(d);

  function copyAll() {
    navigator.clipboard?.writeText(md).then(
      () => alert("Copied all docs as Markdown."),
      () => alert("Clipboard not available — select the text manually.")
    );
  }

  return (
    <div className="docs-page">
      <div className="docs-head">
        <h2>{d.app_name} — Documentation</h2>
        <span className="muted">v{d.version} · generated {new Date(d.generated_at).toLocaleString()}</span>
        <button className="btn-primary" onClick={copyAll}>Copy all as Markdown</button>
        <button className="btn-link" onClick={load}>Refresh</button>
      </div>

      <section>
        <h3>Overview</h3>
        <p>{d.overview}</p>
      </section>

      <section>
        <h3>Board columns</h3>
        <table className="data-table">
          <thead><tr><th>Column</th><th>Cards</th></tr></thead>
          <tbody>
            {d.columns.map((c: any) => (
              <tr key={c.id}><td><span className="swatch" style={{ background: c.color }} /> {c.name}</td><td>{c.card_count}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3>Categories</h3>
        <ul className="pill-list">
          {d.categories.map((c: any) => <li key={c.id}><span className="tag" style={{ background: c.color }}>{c.name}</span> {c.description}</li>)}
        </ul>
      </section>

      <section>
        <h3>Platforms</h3>
        <div className="chip-row">
          {d.platforms.map((p: string) => <span key={p} className="chip on">{p}</span>)}
        </div>
      </section>

      <section>
        <h3>Card fields reference</h3>
        <table className="data-table">
          <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
          <tbody>
            {d.card_fields.map((f: any) => (
              <tr key={f.name}><td><code>{f.name}</code></td><td>{f.type}</td><td>{f.description}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3>How to use the card workspace</h3>
        <ol>
          <li>Click a card title on the board to open its workspace (<code>/card/:id</code>).</li>
          <li>Use the <strong>Draft</strong> tab for working content — it autosaves after 1s.</li>
          <li>Add media, resources, and a checklist in their tabs.</li>
          <li>Leave instructions for Hermes in the <strong>Notes</strong> tab.</li>
          <li>Toggle <strong>Platform ready</strong> when the card is ready to publish.</li>
        </ol>
      </section>

      <section>
        <h3>Toolbar and data management</h3>
        <p>The board toolbar has a <strong>Backup</strong> button (moderator+). Admins can also reach Backup &amp; Restore under Admin → Data.</p>
      </section>

      <section>
        <h3>Backup and restore guide</h3>
        <ol>
          <li>Click <strong>Backup</strong> to download <code>wjw-backup-YYYY-MM-DD.json</code>.</li>
          <li>The file contains all cards, a sha256 checksum, and an embedded manual.</li>
          <li>To restore: choose the file, review the validation warnings, then confirm.</li>
          <li>A checksum mismatch or schema-version difference is warned before replacing anything.</li>
        </ol>
      </section>

      <section>
        <h3>Live feature status</h3>
        <div className="feature-status-grid">
          <FeatureCard title="Content pipeline" enabled={d.features.content_pipeline.enabled}
            detail={`${d.features.content_pipeline.total} item(s)`} />
          <FeatureCard title="Content calendar" enabled={d.features.calendar.enabled}
            detail={`${d.features.calendar.scheduled_cards} scheduled`} />
          <FeatureCard title="Team chat" enabled={d.features.team_chat.enabled}
            detail={`${d.features.team_chat.channels} channels · ${d.features.team_chat.threads} threads`} />
          <FeatureCard title="Hermes assistant" enabled={d.features.hermes_chat.enabled}
            detail="AI sidebar" />
          <FeatureCard title="Memory (RAG)" enabled={d.features.memory.enabled}
            detail={`${d.features.memory.notes} note(s)`} />
          <FeatureCard title="Files" enabled={d.features.files.enabled}
            detail={`${d.features.files.total} file(s)`} />
        </div>
        <p className="muted">Content by status: draft {d.features.content_pipeline.by_status.draft} · in review {d.features.content_pipeline.by_status.in_review} · approved {d.features.content_pipeline.by_status.approved} · published {d.features.content_pipeline.by_status.published} · rejected {d.features.content_pipeline.by_status.rejected}.</p>
      </section>

      <section>
        <h3>Board stats</h3>
        <p>Total cards: <strong>{d.board_stats.total_cards}</strong> · Columns: {d.board_stats.column_count} · Categories: {d.board_stats.category_count}</p>
      </section>
    </div>
  );
}

function FeatureCard({ title, enabled, detail }: { title: string; enabled: boolean; detail: string }) {
  return (
    <div className="feature-card">
      <div className="feature-head">
        <span className="feature-name">{title}</span>
        <span className={enabled ? "feature-on" : "feature-off"}>{enabled ? "on" : "off"}</span>
      </div>
      <div className="feature-detail muted">{detail}</div>
    </div>
  );
}

function toMarkdown(d: any): string {
  const lines: string[] = [];
  lines.push(`# ${d.app_name} — Documentation`);
  lines.push(`*v${d.version} · generated ${new Date(d.generated_at).toLocaleString()}*`);
  lines.push("");
  lines.push(`## Overview`);
  lines.push(d.overview);
  lines.push("");
  lines.push(`## Board columns`);
  for (const c of d.columns) lines.push(`- **${c.name}** — ${c.card_count} card(s)`);
  lines.push("");
  lines.push(`## Categories`);
  for (const c of d.categories) lines.push(`- ${c.name} — ${c.description || ""}`);
  lines.push("");
  lines.push(`## Platforms`);
  lines.push(d.platforms.join(", "));
  lines.push("");
  lines.push(`## Card fields reference`);
  lines.push(`| Field | Type | Description |`);
  lines.push(`| --- | --- | --- |`);
  for (const f of d.card_fields) lines.push(`| \`${f.name}\` | ${f.type} | ${f.description} |`);
  lines.push("");
  lines.push(`## How to use the card workspace`);
  lines.push(`- Click a card title on the board to open its workspace.`);
  lines.push(`- The Draft tab autosaves after 1s.`);
  lines.push(`- Leave instructions for Hermes in the Notes tab.`);
  lines.push(`- Toggle Platform ready when the card is publishable.`);
  lines.push("");
  lines.push(`## Backup and restore`);
  lines.push(`- Backup downloads \`wjw-backup-YYYY-MM-DD.json\` with a sha256 checksum.`);
  lines.push(`- Restore validates the checksum and warns on mismatch before replacing board state.`);
  lines.push("");
  lines.push(`## Board stats`);
  lines.push(`Total cards: ${d.board_stats.total_cards} · Columns: ${d.board_stats.column_count} · Categories: ${d.board_stats.category_count}`);
  lines.push("");
  return lines.join("\n");
}
