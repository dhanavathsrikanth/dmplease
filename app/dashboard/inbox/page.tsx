import { Suspense } from "react";
import { connection } from "next/server";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import {
  InboxInteractiveChat,
  type ConversationItem,
  type StoredMessage,
} from "@/components/inbox/inbox-interactive-chat";

export const metadata = {
  title: "Inbox - dmplease",
};

interface ContactJoin {
  instagram_id: string;
  username: string | null;
  display_name: string | null;
}

interface ConversationRow {
  id: string;
  workspace_id: string;
  instagram_account_id: string | null;
  contact_id: string;
  status: string;
  is_bot_active: boolean | null;
  last_message_at: string;
  contact: ContactJoin | ContactJoin[] | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  direction: string;
  sender_type: string;
  content: unknown;
  delivery_status: string | null;
  created_at: string;
}

function InboxSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <Skeleton className="h-8 w-56 rounded-xl" />
      <Skeleton className="h-[540px] rounded-xl" />
    </div>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content && typeof content === "object") {
    const value = content as Record<string, unknown>;
    if (typeof value.text === "string") return value.text;
    if (typeof value.body === "string") return value.body;
    if (typeof value.message === "string") return value.message;
  }
  return "";
}

function joinedContact(value: ConversationRow["contact"]): ContactJoin | null {
  if (Array.isArray(value)) return value[0] || null;
  return value;
}

export default function InboxPage() {
  return (
    <Suspense fallback={<InboxSkeleton />}>
      <InboxContent />
    </Suspense>
  );
}

async function InboxContent() {
  await connection();
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  const workspaceIds = (profile?.ownedWorkspaces || []).map((workspace) => workspace.id);
  const conversations: ConversationItem[] = [];

  if (workspaceIds.length > 0) {
    const { data: conversationRows, error: conversationError } = await supabase
      .from("conversations")
      .select(
        "id, workspace_id, instagram_account_id, contact_id, status, is_bot_active, last_message_at, contact:contacts(instagram_id, username, display_name)"
      )
      .in("workspace_id", workspaceIds)
      .order("last_message_at", { ascending: false })
      .limit(50);

    if (conversationError) {
      console.warn("[inbox] Could not load conversations:", conversationError.message);
    }

    const rows = (conversationRows || []) as ConversationRow[];

    if (rows.length > 0) {
      const ids = rows.map((row) => row.id);
      const { data: messageRows, error: messageError } = await supabase
        .from("messages")
        .select("id, conversation_id, direction, sender_type, content, delivery_status, created_at")
        .in("conversation_id", ids)
        .order("created_at", { ascending: true })
        .limit(1000);

      if (messageError) {
        console.warn("[inbox] Could not load messages:", messageError.message);
      }

      const messagesByConversation: Record<string, StoredMessage[]> = {};
      for (const row of (messageRows || []) as MessageRow[]) {
        const stored: StoredMessage = {
          id: row.id,
          direction: row.direction === "inbound" ? "inbound" : "outbound",
          senderType:
            row.sender_type === "contact" ||
            row.sender_type === "bot" ||
            row.sender_type === "agent"
              ? row.sender_type
              : "bot",
          text: messageText(row.content),
          time: formatTime(row.created_at),
          status: row.delivery_status,
        };
        if (!messagesByConversation[row.conversation_id]) {
          messagesByConversation[row.conversation_id] = [];
        }
        messagesByConversation[row.conversation_id].push(stored);
      }

      for (const row of rows) {
        const contact = joinedContact(row.contact);
        if (!contact?.instagram_id) continue;
        const username = (contact.username || contact.display_name || "follower").replace(/^@/, "").trim();
        const messages = messagesByConversation[row.id] || [];
        const lastMessage = messages[messages.length - 1];

        conversations.push({
          id: row.id,
          conversationId: row.id,
          workspaceId: row.workspace_id,
          instagramAccountId: row.instagram_account_id,
          recipientId: contact.instagram_id,
          username,
          initials: username.slice(0, 2).toUpperCase(),
          lastMessage: lastMessage?.text || "No messages in this thread yet.",
          time: formatTime(row.last_message_at),
          keyword: (row.status || "open").toUpperCase(),
          keywordLabel: "Status",
          status: row.status || "open",
          messages,
        });
      }
    }

    // Fallback: legacy delivery logs when the new conversation tables are empty.
    if (conversations.length === 0) {
      const { data: logs } = await supabase
        .from("dm_logs")
        .select("id, workspace_id, recipient_id, recipient_username, trigger_keyword, dm_message, status, sent_at")
        .in("workspace_id", workspaceIds)
        .order("sent_at", { ascending: false })
        .limit(50);

      const seen = new Set<string>();
      for (const log of logs || []) {
        const u = log.recipient_username?.replace(/^@/, "").trim() || "follower";
        if (!seen.has(u)) {
          seen.add(u);
          conversations.push({
            id: log.id,
            workspaceId: log.workspace_id,
            recipientId: log.recipient_id || log.id,
            username: u,
            initials: u.slice(0, 2).toUpperCase(),
            lastMessage: log.dm_message || "Automated direct message delivered.",
            time: new Date(log.sent_at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }),
            keyword: log.trigger_keyword || "KEYWORD",
            status: log.status || "Delivered",
          });
        }
      }
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300 antialiased selection:bg-[#ffd02f] selection:text-[#1c1c1e]">
      <div className="pb-3 border-b border-[#e0e2e8] dark:border-border/80">
        <h1 className="text-2xl sm:text-3xl font-medium tracking-tight text-foreground flex items-center gap-2">
          Direct Inbox
        </h1>
        <p className="text-[#555a6a] dark:text-muted-foreground text-xs sm:text-sm mt-0.5">
          View automated direct message conversations and follower interactions in real-time.
        </p>
      </div>

      <InboxInteractiveChat conversations={conversations} />
    </div>
  );
}
