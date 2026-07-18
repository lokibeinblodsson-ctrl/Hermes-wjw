import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../App";

interface ContentItem {
  id: string;
  title: string;
  body: string;
  image_prompt: string;
  image_url: string | null;
  status: "draft" | "in_review" | "approved" | "published" | "rejected";
  reviewer_note: string;
  created_by: string;
  updated_at: string;
}

// Publishing pipeline UI. Everyone with the Publish tab can view the queue.
// - authors (any role) can create drafts + submit for review
// - reviewers+ can approve/reject
// - moderators+ can publish (generates + stores the hero image)
export default function PublishingPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<ContentItem[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [prompt, setPrompt] = useState("");

  const canReview = user && ["reviewer", "moderator", "admin"].includes(user.role);
  const canPublish = user && ["moderator", "admin"].includes(user.role);

  // Deep-link `?view=review|queue` (from the command palette) filters the list.
  const view = searchParams.get("view");
  const visible = items.filter((it) => {
    if (view === "review") return it.status === "in_review";
    if (view === "queue") return it.status !== "published";
    return true;
  });
  async function load() {
    try {
      const res = await api.get("/publishing");
      if (res.ok) setItems(res.data as ContentItem[]);
    } catch (e: any) {
      setErr(e.message);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function createDraft(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      await api.post("/publishing", { title, body, image_prompt: prompt });
      setTitle(""); setBody(""); setPrompt("");
      await load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  async function act(id: string, action: "submit" | "approve" | "reject" | "publish", note = "") {
    setBusy(true); setErr("");
    try {
      const path = action === "approve" || action === "reject"
        ? `/publishing/${id}/review`
        : `/publishing/${id}/${action}`;
      await api.post(path, action === "approve" || action === "reject" ? { action, note } : undefined);
      await load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="content">
      <h2>Publishing</h2>
      {err && <div className="error">{err}</div>}

      <div className="toolbar">
        <form className="task-form" onSubmit={createDraft} style={{ width: "100%" }}>
          <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} required style={{ flex: "1 1 200px" }} />
          <input placeholder="Image prompt (optional)" value={prompt} onChange={(e) => setPrompt(e.target.value)} style={{ flex: "2 1 300px" }} />
          <button className="btn-primary" disabled={busy || !title}>New draft</button>
        </form>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Status</th>
            <th>Image</th>
            <th>Note</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr><td colSpan={5} className="empty">No content yet.</td></tr>
          )}
          {visible.map((it) => (
            <tr key={it.id}>
              <td>
                <div><strong>{it.title}</strong></div>
                {it.body && <div className="muted" style={{ fontSize: 12 }}>{it.body.slice(0, 80)}</div>}
              </td>
              <td><span className={`badge`}>{it.status}</span></td>
              <td>{it.image_url ? <span className="tag">stored</span> : <span className="muted">—</span>}</td>
              <td className="muted" style={{ fontSize: 12 }}>{it.reviewer_note || ""}</td>
              <td>
                {it.status === "draft" && (
                  <button className="btn-link small" disabled={busy} onClick={() => act(it.id, "submit")}>Submit</button>
                )}
                {it.status === "in_review" && canReview && (
                  <>
                    <button className="btn-link small" disabled={busy} onClick={() => act(it.id, "approve")}>Approve</button>
                    <button className="btn-link small danger" disabled={busy} onClick={() => act(it.id, "reject")}>Reject</button>
                  </>
                )}
                {it.status === "approved" && canPublish && (
                  <button className="btn-link small" disabled={busy} onClick={() => act(it.id, "publish")}>Publish</button>
                )}
                {it.status === "published" && it.image_url && (
                  <a className="btn-link small" href={it.image_url} target="_blank" rel="noreferrer">View</a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
