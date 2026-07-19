import { useEffect } from "react";
import { useChat } from "./store";
import { WorkspaceSidebar } from "./components/WorkspaceSidebar";
import { ConversationView } from "./components/ConversationView";
import { ThreadPanel } from "./components/ThreadPanel";
import { SearchDialog } from "./components/SearchDialog";
import { WorkspaceMenu } from "./components/WorkspaceMenu";
import "./wjwchat.css";

// Self-contained WJW Chat experience, mounted as a route inside the host SPA.
export function WjwChatApp() {
  const theme = useChat((s) => s.theme);
  const menuOpen = useChat((s) => s.menuOpen);
  const searchOpen = useChat((s) => s.searchOpen);
  const threadPanelMessageId = useChat((s) => s.threadPanelMessageId);
  const primaryView = useChat((s) => s.primaryView);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
  }, [theme]);

  return (
    <div className="flex h-full w-full overflow-hidden bg-surface text-slate dark:bg-ink-950 dark:text-slate-200">
      <WorkspaceSidebar />
      <main className="relative flex min-w-0 flex-1 flex-col">
        <ConversationView />
      </main>
      {threadPanelMessageId && primaryView === "home" && <ThreadPanel />}
      {searchOpen && <SearchDialog />}
      {menuOpen && <WorkspaceMenu onClose={() => useChat.getState().setMenuOpen(false)} />}
    </div>
  );
}
