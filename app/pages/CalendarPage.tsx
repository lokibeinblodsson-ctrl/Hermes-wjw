// Content calendar page: month grid of scheduled content. Pulls card-level
// scheduled dates + calendar_items. Supports filtering by status/platform and
// clicking an event to open the linked card. A clear "schedule" action lets the
// user place a card on a date without drag/drop (drag/drop is brittle here).
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../App";
import { PLATFORMS } from "../lib/constants";

interface Ev { id: string; kind: "card" | "item"; title: string; status: string; platform?: string; priority?: string; category_name?: string; category_color?: string; note?: string; card_id?: string; }

const STATUS_COLORS: Record<string, string> = {
  draft: "var(--muted)", in_review: "var(--slate)", approved: "var(--accent)",
  published: "var(--stone)", rejected: "var(--danger)", scheduled: "var(--warn)", done: "var(--accent-2)",
};

export default function CalendarPage() {
  const navigate = useNavigate();
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [events, setEvents] = useState<Record<string, Ev[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterPlatform, setFilterPlatform] = useState("");
  const [scheduling, setScheduling] = useState<{ date: string } | null>(null);
  const [unschedCards, setUnschedCards] = useState<any[]>([]);
  const canManage = useAuth().user?.role === "admin" || useAuth().user?.role === "moderator";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get(`/calendar/month?year=${year}&month=${month}`);
      setEvents(r.data.events_by_date || {});
      setError("");
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  function shiftMonth(delta: number) {
    let m = month + delta; let y = year;
    if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
    setMonth(m); setYear(y);
  }

  const cells = buildMonthGrid(year, month);
  const todayStr = new Date().toISOString().slice(0, 10);

  function visibleEvents(date: string): Ev[] {
    let list = events[date] || [];
    if (filterStatus) list = list.filter((e) => e.status === filterStatus);
    if (filterPlatform) list = list.filter((e) => (e.platform && e.platform === filterPlatform) || (e.kind === "card" && false));
    return list;
  }

  async function openScheduler(date: string) {
    if (!canManage) return;
    setScheduling({ date });
    try {
      const r = await api.get("/calendar/cards");
      setUnschedCards(r.data);
    } catch { setUnschedCards([]); }
  }

  async function placeCard(cardId: string) {
    if (!scheduling) return;
    try {
      await api.post(`/calendar/cards/${cardId}/schedule`, { scheduled_date: scheduling.date });
      setScheduling(null);
      load();
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div className="cal-page">
      <div className="cal-toolbar">
        <div className="cal-nav">
          <button className="btn-link" onClick={() => shiftMonth(-1)}>‹</button>
          <strong>{monthName(month)} {year}</strong>
          <button className="btn-link" onClick={() => shiftMonth(1)}>›</button>
        </div>
        <button className="btn-link" onClick={() => { setYear(new Date().getFullYear()); setMonth(new Date().getMonth() + 1); }}>Today</button>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">All statuses</option>
          {["scheduled", "draft", "in_review", "approved", "published", "rejected", "done"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterPlatform} onChange={(e) => setFilterPlatform(e.target.value)}>
          <option value="">All platforms</option>
          {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        {loading && <span className="muted">Loading…</span>}
      </div>
      {error && <div className="error">{error}</div>}

      <div className="cal-grid">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="cal-cell" style={{ minHeight: 28, opacity: 0.7 }}><span className="cal-date">{d}</span></div>
        ))}
        {cells.map((c) => (
          <div key={c.date} className={`cal-cell ${c.other ? "other" : ""} ${c.date === todayStr ? "today" : ""}`}>
            <span className="cal-date">{c.label}</span>
            {visibleEvents(c.date).map((ev) => (
              <div key={ev.id} className={`cal-ev status-${ev.status}`}
                title={ev.note || ev.title}
                onClick={() => { if (ev.kind === "card" && ev.card_id) navigate(`/card/${ev.card_id}`); else if (ev.kind === "card") navigate(`/card/${ev.id}`); }}>
                {ev.title}
              </div>
            ))}
            {canManage && !c.other && (
              <button className="btn-link small" onClick={() => openScheduler(c.date)}>+ schedule</button>
            )}
          </div>
        ))}
      </div>

      <div className="cal-legend">
        {Object.entries(STATUS_COLORS).map(([s, col]) => (
          <span key={s}><span className="dot" style={{ background: col }} />{s}</span>
        ))}
      </div>

      {scheduling && (
        <div className="modal-backdrop" onClick={() => setScheduling(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Schedule content for {scheduling.date}</h3>
            <p className="muted">Pick a card to place on this date. (Drag/drop is intentionally not used — this is reliable.)</p>
            <div className="item-list">
              {unschedCards.map((c) => (
                <li key={c.id}>
                  <span className="item-main">{c.title}</span>
                  <button className="btn-primary" onClick={() => placeCard(c.id)}>Place</button>
                </li>
              ))}
              {unschedCards.length === 0 && <li className="muted">No unscheduled cards.</li>}
            </div>
            <div className="modal-actions">
              <button className="btn-link" onClick={() => setScheduling(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function buildMonthGrid(year: number, month: number) {
  // month is 1-12. Start on Monday.
  const first = new Date(year, month - 1, 1);
  const startDay = (first.getDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(year, month, 0).getDate();
  const daysPrev = new Date(year, month - 1, 0).getDate();
  const cells: { date: string; label: string; other: boolean }[] = [];
  for (let i = 0; i < startDay; i++) {
    const d = daysPrev - startDay + 1 + i;
    const pm = month === 1 ? 12 : month - 1;
    const py = month === 1 ? year - 1 : year;
    cells.push({ date: `${py}-${String(pm).padStart(2, "0")}-${String(d).padStart(2, "0")}`, label: String(d), other: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`, label: String(d), other: false });
  }
  const tail = (7 - (cells.length % 7)) % 7;
  for (let i = 1; i <= tail; i++) {
    const nm = month === 12 ? 1 : month + 1;
    const ny = month === 12 ? year + 1 : year;
    cells.push({ date: `${ny}-${String(nm).padStart(2, "0")}-${String(i).padStart(2, "0")}`, label: String(i), other: true });
  }
  return cells;
}

function monthName(m: number) {
  return ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1];
}
