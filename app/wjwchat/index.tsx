import { useChat, HERMES_CHANNEL_ID } from "./store";
import { WorkspaceSidebar } from "./components/WorkspaceSidebar";
import { ConversationView } from "./components/ConversationView";
import { ThreadPanel } from "./components/ThreadPanel";
import { SearchDialog } from "./components/SearchDialog";
import { WorkspaceMenu } from "./components/WorkspaceMenu";
import { ChatTopNav } from "./components/ChatTopNav";
import "./wjwchat.css";

// WJW Chat experience, mounted as a route inside the host SPA. It lives inside
// the host top-nav shell (see ChatTopNav) and uses the site's calm dark palette
// (the whole WJW app is dark, so we force dark mode for visual consistency).
export function WjwChatApp() {
  const menuOpen = useChat((s) => s.menuOpen);
  const searchOpen = useChat((s) => s.searchOpen);
  const threadPanelMessageId = useChat((s) => s.threadPanelMessageId);
  const primaryView = useChat((s) => s.primaryView);
  const activeId = useChat((s) => s.activeConversationId);
  const hermesConvId = useChat((s) => s.hermesConvId);

  return (
    <div className="dark flex h-full min-h-0 w-full flex-col overflow-hidden bg-ink-950 text-slate-200">
      <ChatTopNav
        activeId={activeId}
        isHermes={activeId === HERMES_CHANNEL_ID}
        hermesConvId={hermesConvId}
      />
      <div className="flex min-h-0 flex-1">
        <WorkspaceSidebar />
        <main className="relative flex min-w-0 flex-1 flex-col">
          <ConversationView />
        </main>
        {threadPanelMessageId && primaryView === "home" && <ThreadPanel />}
      </div>
      {searchOpen && <SearchDialog />}
      {menuOpen && <WorkspaceMenu onClose={() => useChat.getState().setMenuOpen(false)} />}
    </div>
  );
}
