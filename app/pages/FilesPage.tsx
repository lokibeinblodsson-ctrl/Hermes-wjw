// Files page: central place for uploaded PDFs, images, references and brand
// assets. Supports tags, search, previews (inline data: URLs or hosted), and
// delete (staff). Backed by /api/v1/files (metadata + inline/R2/B2 storage).
import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";
import { useAuth } from "../App";

interface FileItem {
  id: string; name: string; kind: string; mime?: string; url?: string | null;
  size_bytes?: number | null; tags: string[]; note: string; created_at?: string; backend?: string;
}

export default function FilesPage() {
  const canManage = useAuth().user?.role === "admin" || useAuth().user?.role === "moderator";
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (kind) params.set("kind", kind);
      if (q) params.set("q", q);
      const r = await api.get(`/files?${params.toString()}`);
      setFiles(r.data);
      setError("");
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [kind, q]);

  useEffect(() => { load(); }, [load]);

  async function upload() {
    if (!file && !name.trim()) { setError("Choose a file or give it a name."); return; }
    setUploading(true); setError("");
    try {
      let url: string | undefined;
      if (file) {
        url = await fileToDataUrl(file);
      }
      const r = await api.post("/files", {
        name: name.trim() || file?.name || "file",
        kind: file ? undefined : "file",
        mime: file?.type,
        tags: tagsText.split(",").map((t) => t.trim()).filter(Boolean),
        note: note.trim(),
        url,
      });
      if (r.status === 201) {
        setName(""); setNote(""); setTagsText(""); setFile(null);
        load();
      }
    } catch (e: any) { setError(e.message); }
    finally { setUploading(false); }
  }

  async function remove(id: string) {
    if (!confirm("Delete this file?")) return;
    try { await api.delete(`/files/${id}`); load(); } catch (e: any) { setError(e.message); }
  }

  return (
    <div className="files-page">
      <h2>Files</h2>
      <p className="muted">Uploaded PDFs, images, references and brand assets. Tagged and searchable.</p>

      <div className="toolbar">
        <input placeholder="Search files…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">All kinds</option>
          {["image", "pdf", "doc", "asset", "file", "link"].map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </div>

      {canManage && (
        <div className="data-card" style={{ marginBottom: 14 }}>
          <h3>Upload</h3>
          <div className="add-row">
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <input placeholder="name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="add-row">
            <input placeholder="tags (comma separated)" value={tagsText} onChange={(e) => setTagsText(e.target.value)} />
            <input placeholder="note" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="btn-primary" disabled={uploading} onClick={upload}>Upload</button>
          </div>
          <p className="muted">Stored inline (data URL) when no R2/B2 bucket is configured. Connect R2/B2 in wrangler for hosted URLs.</p>
        </div>
      )}

      {error && <div className="error">{error}</div>}
      {loading && <div className="muted">Loading…</div>}

      <div className="files-grid">
        {files.map((f) => (
          <div key={f.id} className="file-card">
            <div className="file-name">{f.name}</div>
            {f.kind === "image" && f.url && f.url.startsWith("data:") && (
              <img className="file-thumb" src={f.url} alt={f.name} />
            )}
            {f.kind === "image" && f.url && !f.url.startsWith("data:") && (
              <a href={f.url} target="_blank" rel="noreferrer">view ↗</a>
            )}
            <div className="file-meta">
              {f.kind}{f.size_bytes ? ` · ${(f.size_bytes / 1024).toFixed(1)} KB` : ""}{f.created_at ? ` · ${f.created_at.slice(0, 10)}` : ""}
            </div>
            {f.note && <div className="file-meta">{f.note}</div>}
            <div className="file-tags">
              {f.tags.map((t) => <span key={t} className="tag outline">{t}</span>)}
            </div>
            {f.url && f.kind !== "image" && (
              <div className="file-meta"><a href={f.url} target="_blank" rel="noreferrer">open ↗</a> {f.backend ? `(${f.backend})` : ""}</div>
            )}
            {canManage && <div className="modal-actions" style={{ marginTop: 8 }}>
              <button className="btn-link danger small" onClick={() => remove(f.id)}>delete</button>
            </div>}
          </div>
        ))}
        {files.length === 0 && !loading && <div className="muted">No files yet. {canManage ? "Upload one above." : ""}</div>}
      </div>
    </div>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("Could not read file"));
    r.readAsDataURL(file);
  });
}
