import { Suspense } from "react";
import { connection } from "next/server";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { InboxInteractiveChat, ConversationItem } from "@/components/inbox/inbox-interactive-chat";

export const metadata = {
  title: "Inbox - dmplease",
};

function InboxSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <Skeleton className="h-8 w-56 rounded-xl" />
      <Skeleton className="h-[540px] rounded-xl" />
    </div>
  );
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

  const workspaceIds = (profile?.ownedWorkspaces || []).map((w) => w.id);

  let conversations: ConversationItem[] = [];

  if (workspaceIds.length > 0) {
    const { data: logs } = await supabase
      .from("dm_logs")
      .select("id, recipient_id, recipient_username, trigger_keyword, dm_message, status, sent_at")
      .in("workspace_id", workspaceIds)
      .order("sent_at", { ascending: false })
      .limit(50);

    if (logs && logs.length > 0) {
      const seen = new Set<string>();
      for (const log of logs) {
        const u = log.recipient_username?.replace(/^@/, "").trim() || "follower";
        if (!seen.has(u)) {
          seen.add(u);
          const initials = u.slice(0, 2).toUpperCase();
          conversations.push({
            id: log.id,
            recipientId: log.recipient_id || log.id,
            username: u,
            initials,
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
