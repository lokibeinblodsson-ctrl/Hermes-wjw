// Backup / Restore UI. Used both in the Admin "Data" tab and (imported) on the
// board toolbar. Backup downloads a JSON file; restore uploads + validates
// (checksum + schema version) then requires explicit confirmation.
import { useState, useRef } from "react";
import { api } from "../lib/api";

export default function DataPage({ compact = false }: { compact?: boolean }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function download(filename: string, text: string) {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  async function doBackup() {
    setBusy(true); setError("");
    try {
      const res = await api.get("/data/backup");
      const data = res.data;
      const stamp = new Date(data.timestamp).toISOString().slice(0, 10);
      download(`wjw-backup-${stamp}.json`, JSON.stringify(data, null, 2));
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(""); setPreview(null); setReport(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      let parsed: any;
      try { parsed = JSON.parse(text); } catch { setError("That file is not valid JSON."); return; }
      // Build a restore payload: accept envelope, {backup}, or flat array.
      const body: any = Array.isArray(parsed) ? parsed : parsed.backup ? { backup: parsed.backup } : { backup: parsed };
      const res = await api.post("/data/restore", body);
      setPreview({ ...res.data, file: file.name });
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function confirmRestore() {
    if (!preview) return;
    if (!confirm(`Replace the current board with ${preview.card_count} card(s)? This overwrites board state.`)) return;
    setBusy(true); setError("");
    try {
      const file = fileRef.current?.files?.[0];
      if (!file) { setError("Re-select the backup file to confirm."); return; }
      const text = await file.text();
      const parsed = JSON.parse(text);
      const body = Array.isArray(parsed) ? parsed.concat({ confirm: true }) : parsed.backup ? { backup: parsed.backup, confirm: true } : { backup: parsed, confirm: true };
      const res = await api.post("/data/restore", body);
      setReport(res.data);
      setPreview(null);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className={compact ? "data-card" : "data-page"}>
      {!compact && <h2>Data — Backup &amp; Restore</h2>}
      {error && <div className="error">{error}</div>}

      <div className="data-actions">
        <button className="btn-primary" disabled={busy} onClick={doBackup}>⬇ Backup (download JSON)</button>
        <label className="btn-primary file-btn">
          ⬆ Restore (choose file)
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={onFile} hidden />
        </label>
      </div>

      {preview && (
        <div className="restore-preview">
          <h4>Restore validation — {preview.file}</h4>
          <p>Cards found: <strong>{preview.card_count}</strong></p>
          {preview.warnings.length > 0 && (
            <ul className="warn-list">
              {preview.warnings.map((w: string, i: number) => <li key={i}>⚠ {w}</li>)}
            </ul>
          )}
          <button className="btn-danger" disabled={busy} onClick={confirmRestore}>Replace board state</button>
          <button className="btn-link" onClick={() => { setPreview(null); if (fileRef.current) fileRef.current.value = ""; }}>Cancel</button>
        </div>
      )}

      {report && (
        <div className="restore-report">
          <p>✅ Restored <strong>{report.restored}</strong> card(s).</p>
          {report.warnings?.length > 0 && (
            <ul className="warn-list">
              {report.warnings.map((w: string, i: number) => <li key={i}>⚠ {w}</li>)}
            </ul>
          )}
        </div>
      )}

      <p className="muted">
        Backups include all card fields, a sha256 checksum, and an embedded instruction manual.
        Restore accepts the new format or a bare array of cards.
      </p>
    </div>
  );
}
