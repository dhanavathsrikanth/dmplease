import { Suspense } from "react";
import { connection } from "next/server";
import {
  CheckCircle2,
  Clock,
  Inbox,
  AlertCircle,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getCurrentProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "DM Logs - dmplease",
};

function LogsSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between pb-2 border-b">
        <Skeleton className="h-8 w-56 rounded-xl" />
        <Skeleton className="h-8 w-48 rounded-lg" />
      </div>
      <Skeleton className="h-96 rounded-xl" />
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
    <div className="space-y-6 animate-in fade-in duration-300 antialiased selection:bg-[#ffd02f] selection:text-[#1c1c1e]">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-[#e0e2e8] dark:border-border/80">
        <div>
          <h1 className="text-2xl sm:text-3xl font-medium tracking-tight text-foreground flex items-center gap-2">
            DM Execution Logs
          </h1>
          <p className="text-[#555a6a] dark:text-muted-foreground text-xs sm:text-sm mt-0.5">
            Real-time delivery verification and payload audit log for all Instagram comment triggers.
          </p>
        </div>

        {/* Filter Pills in Liquid Glass pill style */}
        <div className="flex items-center gap-1.5 p-1 rounded-full glass-pill text-xs font-semibold self-start sm:self-auto">
          <span className="px-3.5 py-1 rounded-full bg-[#1c1c1e] text-white shadow-xs font-semibold dark:bg-white dark:text-[#1c1c1e]">
            All ({totalCount})
          </span>
          <span className="px-3.5 py-1 rounded-full text-[#6b6f7e]">
            Delivered ({deliveredCount})
          </span>
          <span className="px-3.5 py-1 rounded-full text-[#6b6f7e]">
            Failed ({failedCount})
          </span>
        </div>
      </div>

      {/* ── Logs Explorer (Miro Liquid Glass Table) ── */}
      <Card className="rounded-2xl glass-card overflow-hidden">
        {logs.length > 0 ? (
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead className="w-[180px]">Recipient</TableHead>
                <TableHead className="w-[120px]">Trigger</TableHead>
                <TableHead>Automated DM Payload</TableHead>
                <TableHead className="w-[160px]">Timestamp</TableHead>
                <TableHead className="text-right w-[110px]">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.id} className="hover:bg-muted/30">
                  <TableCell className="font-semibold text-xs sm:text-sm text-foreground">
                    {log.user}
                  </TableCell>
                  <TableCell>
                    <span className="px-2 py-0.5 rounded-full bg-[#fff8e0] text-[#746019] border border-[#ffd02f]/30 font-semibold text-[10px] font-mono">
                      {log.keyword}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-[#555a6a] dark:text-muted-foreground font-sans max-w-md truncate">
                    &ldquo;{log.message}&rdquo;
                  </TableCell>
                  <TableCell className="text-[11px] font-mono text-[#6b6f7e]">
                    <span className="flex items-center gap-1">
                      <Clock className="size-3" /> {log.time}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge
                      variant={log.status === "Delivered" ? "tag-teal" : "destructive"}
                      className="text-[10px] font-semibold py-0.5 px-2.5 rounded-full gap-1"
                    >
                      {log.status === "Delivered" ? (
                        <CheckCircle2 className="size-3 text-[#00b473]" />
                      ) : (
                        <AlertCircle className="size-3" />
                      )}
                      {log.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="p-12 text-center space-y-3">
            <div className="size-11 rounded-2xl bg-[#fff8e0] text-[#746019] flex items-center justify-center mx-auto shadow-xs">
              <Inbox className="size-5" />
            </div>
            <div>
              <p className="font-semibold text-base text-foreground">
                No DM delivery logs yet
              </p>
              <p className="text-xs text-[#555a6a] dark:text-muted-foreground max-w-sm mx-auto mt-1">
                When followers comment trigger keywords on your Instagram posts or reels, automated direct messages and delivery status will appear here.
              </p>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
