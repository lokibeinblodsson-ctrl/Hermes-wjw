import { useMemo } from "react";
import { useChat } from "../store";
import { getUser } from "../utils";
import { workspace } from "../seed";
import { ConversationHeader } from "./ConversationHeader";
import { MessageList } from "./MessageList";
import { MessageComposer } from "./MessageComposer";
import { ActivityFeed } from "./ActivityFeed";
import { SavedView } from "./SavedView";
import { EmptyState } from "./EmptyState";
import type { Conversation } from "../types";

export function ConversationView() {
  const primaryView = useChat((s) => s.primaryView);
  const activeId = useChat((s) => s.activeConversationId);
  const conversations = useChat((s) => s.conversations);

  const conv = useMemo<Conversation | undefined>(
    () => conversations.find((c) => c.id === activeId),
    [conversations, activeId]
  );
  const title = useMemo(() => {
    if (!conv) return "";
    if (conv.kind === "dm") return getUser(conv.userId).name;
    return conv.name;
  }, [conv]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {primaryView === "activity" ? (
        <ActivityFeed />
      ) : primaryView === "saved" ? (
        <SavedView />
      ) : conv ? (
        <>
          <ConversationHeader conv={conv} />
          <MessageList conv={conv} />
          <MessageComposer conv={conv} placeholder={`Message ${conv.kind === "dm" ? title : "#" + title}`} />
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            title="No conversation selected"
            hint={`Pick a channel or direct message from the ${workspace.name} sidebar to start.`}
          />
        </div>
      )}
    </div>
  );
}
