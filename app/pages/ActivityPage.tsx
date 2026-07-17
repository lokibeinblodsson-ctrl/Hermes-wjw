// Activity center: recent audit + analytics events. Backed by /api/v1/activity
// (see src/routes/api.ts). Read-only feed for any authenticated user.
import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";

interface Activity {
  id: string;
  action: string;
  actor_id: string | null;
  target_type: string | null;
  target_id: string | null;
  meta: any;
  created_at: string;
}

export default function ActivityPage() {
  const [items, setItems] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/activity");
      setItems(r.data || []);
      setError("");
    } catch (e: any) {
      setError(e.message || "Failed to load activity");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="activity-page">
      <div className="docs-head">
        <h2>Activity</h2>
        <button className="btn-link" onClick={load}>Refresh</button>
      </div>
      <p className="muted">Recent audit + analytics events across the platform.</p>
      {error && <div className="error">{error}</div>}
      {loading && <div className="muted">Loading…</div>}
      <div className="results">
        {items.map((a) => (
          <div className="mem-card" key={a.id}>
            <div className="mem-head">
              <span className="mem-title">{a.action}</span>
              <span className="mem-time">{new Date(a.created_at).toLocaleString()}</span>
            </div>
            <div className="mem-summary">
              {a.target_type && <span className="tag outline">{a.target_type}</span>}
              {a.actor_id && <span className="muted"> · by {a.actor_id.slice(0, 8)}</span>}
            </div>
          </div>
        ))}
        {items.length === 0 && !loading && <div className="muted">No activity yet.</div>}
      </div>
    </div>
  );
}
