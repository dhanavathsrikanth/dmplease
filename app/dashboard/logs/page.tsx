import { Suspense } from "react";
import { connection } from "next/server";
import {
  History,
  CheckCircle2,
  Clock,
  Inbox,
  AlertCircle,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "DM Logs - dmplease",
};

function LogsSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-56 rounded-xl" />
        <Skeleton className="h-8 w-48 rounded-xl" />
      </div>
      <Skeleton className="h-96 rounded-2xl" />
    </div>
  );
}

export default function DmLogsPage() {
  return (
    <Suspense fallback={<LogsSkeleton />}>
      <DmLogsContent />
    </Suspense>
  );
}

async function DmLogsContent() {
  await connection();
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  const workspaceIds = (profile?.ownedWorkspaces || []).map((w) => w.id);

  let logs: Array<{
    id: string;
    user: string;
    keyword: string;
    message: string;
    status: string;
    time: string;
  }> = [];

  let totalCount = 0;
  let deliveredCount = 0;
  let failedCount = 0;

  if (workspaceIds.length > 0) {
    const { data, count } = await supabase
      .from("dm_logs")
      .select("id, recipient_username, trigger_keyword, dm_message, status, sent_at", {
        count: "exact",
      })
      .in("workspace_id", workspaceIds)
      .order("sent_at", { ascending: false })
      .limit(50);

    totalCount = count || 0;

    if (data && data.length > 0) {
      logs = data.map((l) => {
        const isDelivered =
          l.status === "SENT" || l.status === "Delivered" || !l.status;
        return {
          id: l.id,
          user: l.recipient_username
            ? l.recipient_username.startsWith("@")
              ? l.recipient_username
              : `@${l.recipient_username}`
            : "@unknown",
          keyword: l.trigger_keyword || "N/A",
          message: l.dm_message || "Direct Message sent automatically.",
          status: isDelivered ? "Delivered" : l.status,
          time: new Date(l.sent_at).toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }),
        };
      });

      deliveredCount = logs.filter((l) => l.status === "Delivered").length;
      failedCount = logs.filter(
        (l) => l.status === "FAILED" || l.status === "Failed"
      ).length;
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <History className="size-6 text-primary" />
            DM Delivery Audit Logs
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Real-time delivery verification for all Instagram comment-triggered direct messages.
          </p>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl border border-border/80 bg-muted/40 text-xs font-semibold self-start sm:self-auto">
          <span className="px-2.5 py-1 rounded-lg bg-background text-foreground shadow-xs">
            All ({totalCount})
          </span>
          <span className="px-2.5 py-1 rounded-lg text-muted-foreground">
            Delivered ({deliveredCount})
          </span>
          <span className="px-2.5 py-1 rounded-lg text-muted-foreground">
            Failed ({failedCount})
          </span>
        </div>
      </div>

      {/* ── Logs Table / Cards ── */}
      <Card className="rounded-2xl border-border/80 shadow-xs overflow-hidden">
        {logs.length > 0 ? (
          <div className="divide-y divide-border/60">
            {logs.map((log) => (
              <div
                key={log.id}
                className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-muted/30 transition-colors"
              >
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-foreground">
                      {log.user}
                    </span>
                    <span className="text-xs text-muted-foreground">&bull;</span>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <span>Trigger:</span>
                      <code className="px-1.5 py-0.2 rounded bg-muted font-mono font-bold text-foreground text-[11px]">
                        {log.keyword}
                      </code>
                    </div>
                    <span className="text-xs text-muted-foreground">&bull;</span>
                    <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Clock className="size-3" /> {log.time}
                    </span>
                  </div>

                  <p className="text-xs text-muted-foreground truncate italic">
                    &ldquo;{log.message}&rdquo;
                  </p>
                </div>

                <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                  <Badge
                    variant="outline"
                    className={
                      log.status === "Delivered"
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-xs font-semibold gap-1"
                        : "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30 text-xs font-semibold gap-1"
                    }
                  >
                    {log.status === "Delivered" ? (
                      <CheckCircle2 className="size-3" />
                    ) : (
                      <AlertCircle className="size-3" />
                    )}
                    {log.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-12 text-center space-y-3">
            <div className="size-12 rounded-2xl bg-muted flex items-center justify-center mx-auto text-muted-foreground">
              <Inbox className="size-6" />
            </div>
            <div>
              <p className="font-semibold text-sm text-foreground">
                No DM delivery logs yet
              </p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto mt-1">
                When followers comment trigger keywords on your Instagram posts or reels, automated direct messages and delivery status will appear here.
              </p>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
