import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import {
  MessageSquare,
  Search,
  CheckCircle2,
  Send,
  Inbox,
  Instagram,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Inbox - dmplease",
};

function InboxSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <Skeleton className="h-8 w-56 rounded-xl" />
      <Skeleton className="h-[540px] rounded-2xl" />
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

  let conversations: Array<{
    id: string;
    username: string;
    initials: string;
    lastMessage: string;
    time: string;
    keyword: string;
    status: string;
  }> = [];

  if (workspaceIds.length > 0) {
    const { data: logs } = await supabase
      .from("dm_logs")
      .select("id, recipient_username, trigger_keyword, dm_message, status, sent_at")
      .in("workspace_id", workspaceIds)
      .order("sent_at", { ascending: false })
      .limit(30);

    if (logs && logs.length > 0) {
      const seen = new Set<string>();
      for (const log of logs) {
        const u = log.recipient_username?.replace(/^@/, "").trim() || "follower";
        if (!seen.has(u)) {
          seen.add(u);
          const initials = u.slice(0, 2).toUpperCase();
          conversations.push({
            id: log.id,
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

  const activeConv = conversations[0] || null;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <MessageSquare className="size-6 text-primary" />
          Instagram Direct Inbox
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          View automated DM conversations and follower interactions directly from your dashboard.
        </p>
      </div>

      {conversations.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[540px]">
          {/* Left: Conversations List */}
          <Card className="rounded-2xl border-border/80 shadow-xs flex flex-col overflow-hidden">
            <div className="p-3 border-b border-border/60">
              <div className="relative">
                <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search conversations..."
                  className="pl-8 text-xs rounded-xl h-8 bg-muted/40 border-border/70"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-border/60">
              {conversations.map((c, i) => (
                <div
                  key={c.id}
                  className={`p-3.5 flex items-start gap-3 cursor-pointer transition-colors ${
                    i === 0 ? "bg-muted/60" : "hover:bg-muted/30"
                  }`}
                >
                  <Avatar className="size-9 shrink-0">
                    <AvatarFallback className="text-xs font-bold bg-neutral-900 text-white dark:bg-white dark:text-neutral-900">
                      {c.initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-foreground truncate">
                        @{c.username}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{c.time}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                      Trigger: {c.keyword}
                    </p>
                    <p className="text-xs text-foreground truncate mt-1">
                      {c.lastMessage}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Right: Active Chat View */}
          <Card className="lg:col-span-2 rounded-2xl border-border/80 shadow-xs flex flex-col justify-between overflow-hidden">
            {/* Chat Header */}
            <div className="p-4 border-b border-border/60 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Avatar className="size-9">
                  <AvatarFallback className="text-xs font-bold bg-neutral-900 text-white dark:bg-white dark:text-neutral-900">
                    {activeConv?.initials}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-semibold text-xs sm:text-sm text-foreground">
                    @{activeConv?.username}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Instagram Direct &bull; Verified Recipient
                  </p>
                </div>
              </div>
              <Badge
                variant="outline"
                className="text-[10px] bg-lime-500/10 text-lime-700 dark:text-lime-300 border-lime-500/30"
              >
                Triggered via {activeConv?.keyword}
              </Badge>
            </div>

            {/* Messages Stream */}
            <div className="flex-1 p-4 overflow-y-auto space-y-4 text-xs">
              <div className="text-center">
                <span className="px-2.5 py-1 rounded-full bg-muted text-[10px] text-muted-foreground">
                  User triggered comment keyword &ldquo;{activeConv?.keyword}&rdquo; &bull; Auto-DM delivered
                </span>
              </div>

              {/* Outgoing automated message */}
              <div className="flex justify-end">
                <div className="max-w-md rounded-2xl rounded-tr-xs bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 p-3 space-y-1">
                  <p>{activeConv?.lastMessage}</p>
                  <p className="text-[9px] text-neutral-400 dark:text-neutral-600 text-right flex items-center justify-end gap-1">
                    <CheckCircle2 className="size-2.5 inline" /> Sent via dmplease bot &bull; {activeConv?.time}
                  </p>
                </div>
              </div>
            </div>

            {/* Chat Reply Input */}
            <div className="p-3 border-t border-border/60 flex items-center gap-2">
              <Input
                placeholder={`Reply to @${activeConv?.username}...`}
                className="text-xs rounded-xl h-9 bg-muted/40 border-border/70"
              />
              <Button
                size="icon"
                className="size-9 rounded-xl shrink-0 bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
              >
                <Send className="size-3.5" />
              </Button>
            </div>
          </Card>
        </div>
      ) : (
        <Card className="rounded-2xl border-dashed p-12 text-center space-y-4">
          <div className="size-12 rounded-2xl bg-muted flex items-center justify-center mx-auto text-muted-foreground">
            <Inbox className="size-6" />
          </div>
          <div>
            <h3 className="font-semibold text-base text-foreground">
              No conversations in your inbox yet
            </h3>
            <p className="text-xs text-muted-foreground max-w-md mx-auto mt-1">
              When followers comment trigger keywords on your Instagram posts, automated direct messages will be dispatched and conversation history will be logged here.
            </p>
          </div>
          <div className="flex items-center justify-center gap-3 pt-2">
            <Button asChild size="sm" className="rounded-xl font-semibold text-xs">
              <Link href="/dashboard/campaigns">View Active Campaigns</Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="rounded-xl font-semibold text-xs">
              <Link href="/dashboard/settings">
                <Instagram className="size-3.5 mr-1 text-rose-500" />
                Check Instagram Link
              </Link>
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
