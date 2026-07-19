import { Link } from "react-router-dom";
import { Sparkles, Bot } from "lucide-react";
import { useChat, HERMES_CHANNEL_ID } from "../store";

// Top menu for the chat experience. Mirrors the host site's .topnav styles
// (defined in app/styles.css) so the chat feels part of the same app, and
// links to every other page on the site.
export function ChatTopNav({
  activeId,
  isHermes,
  hermesConvId,
}: {
  activeId: string;
  isHermes: boolean;
  hermesConvId: string | null;
}) {
  const setActive = useChat((s) => s.setActiveConversation);

  const goHermes = () => {
    if (activeId !== HERMES_CHANNEL_ID) setActive(HERMES_CHANNEL_ID);
  };

  return (
    <nav className="topnav chat-topnav">
      <Link to="/" className="brand">🌿 Wild Jazmine Wellness</Link>
      <div className="nav-links">
        <Link to="/">Board</Link>
        <Link to="/chat" className="active">Chat</Link>
        <Link to="/calendar">Calendar</Link>
        <Link to="/memory">Memory</Link>
        <Link to="/docs">Docs</Link>
        <Link to="/files">Files</Link>
        <Link to="/admin">Admin</Link>
        <button
          className={`btn-link nav-hermes ${isHermes ? "on" : ""}`}
          onClick={goHermes}
          title="Open the Hermes assistant channel"
        >
          <Sparkles size={14} /> Hermes
        </button>
      </div>
      <div className="nav-user">
        <span className="badge">chat</span>
      </div>
    </nav>
  );
}
