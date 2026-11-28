"use client";

import { useState, useTransition } from "react";
import { Loader2, Play } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { drainDmQueueAction } from "@/app/dashboard/campaigns/actions";

interface DmQueueCardProps {
  pending: number;
  failed: number;
  oldestPendingAt: string | null;
  timeZone?: string;
}

export function DmQueueCard({
  pending,
  failed,
  oldestPendingAt,
  timeZone = "Asia/Kolkata",
}: DmQueueCardProps) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await drainDmQueueAction();
        if (!result.success) {
          setError(result.error ?? "Could not drain the queue.");
          return;
        }
        const r = result as {
          success: true;
          processed: number;
          sent: number;
          skipped: number;
          failed: number;
          remaining?: number;
        };
        setMessage(
          `Processed ${r.processed}: ${r.sent} sent, ${r.skipped} skipped, ${r.failed} failed.` +
            (r.remaining ? " More are queued — run again to continue." : "")
        );
      } catch {
        setError("Network error while draining the queue.");
      }
    });
  };

  return (
    <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle">
      <CardHeader className="pb-4 border-b border-[#e0e2e8] dark:border-border/60">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base font-semibold tracking-tight">
              DM queue
            </CardTitle>
            <CardDescription className="text-xs text-[#555a6a] dark:text-muted-foreground">
              Overflow from hourly caps. Drained automatically once an hour; run
              it now to clear it sooner.
            </CardDescription>
          </div>
          <Badge
            variant={pending > 0 ? "tag-teal" : "outline"}
            className="text-[10px] font-semibold rounded-full px-3"
          >
            {pending} pending
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-5 space-y-3">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-xl border border-[#e0e2e8] dark:border-border py-2">
            <p className="text-sm font-bold text-foreground">{pending}</p>
            <p className="text-[10px] text-muted-foreground">Pending</p>
          </div>
          <div className="rounded-xl border border-[#e0e2e8] dark:border-border py-2">
            <p className="text-sm font-bold text-foreground">{failed}</p>
            <p className="text-[10px] text-muted-foreground">Failed</p>
          </div>
          <div className="rounded-xl border border-[#e0e2e8] dark:border-border py-2">
            <p className="text-sm font-bold text-foreground">
              {oldestPendingAt
                ? new Date(oldestPendingAt).toLocaleTimeString("en-IN", {
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone,
                  })
                : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground">Oldest</p>
          </div>
        </div>
        {message && (
          <p role="status" className="text-[11px] font-medium text-[#00b473]">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="text-[11px] font-medium text-destructive">
            {error}
          </p>
        )}
        <Button
          type="button"
          size="sm"
          onClick={run}
          disabled={isPending || pending === 0}
          className="rounded-full text-xs font-semibold h-9 px-4"
        >
          {isPending ? (
            <>
              <Loader2 className="size-3.5 mr-1.5 animate-spin" aria-hidden="true" />
              Draining…
            </>
          ) : (
            <>
              <Play className="size-3.5 mr-1.5" aria-hidden="true" />
              Drain now
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
