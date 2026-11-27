"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Pause, Play, ShieldCheck } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { setSafetyPausedAction } from "@/app/dashboard/campaigns/actions";

interface AccountHealthView {
  id: string;
  username: string | null;
  tokenStatus: string | null;
  consecutiveFailures: number;
  safetyPaused: boolean;
  lastError: string | null;
  lastSendAt: string | null;
}

interface SafetyCardProps {
  stats: { breaches: number; throttles: number; viralSpikes: number; optOuts: number; exceptions: number };
  accounts: AccountHealthView[];
  score?: number;
  band?: string;
}

export function SafetyCard({ stats, accounts, score, band }: SafetyCardProps) {
  const scoreColor =
    (score ?? 100) >= 80
      ? "text-[#00b473]"
      : (score ?? 100) >= 60
        ? "text-[#4262ff]"
        : (score ?? 100) >= 40
          ? "text-amber-500"
          : "text-destructive";
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = (accountId: string, paused: boolean) => {
    setPendingId(accountId);
    setError(null);
    startTransition(async () => {
      try {
        const result = await setSafetyPausedAction(accountId, paused);
        if (!result.success) setError(result.error ?? "Could not update safety state.");
      } catch {
        setError("Network error while updating safety state.");
      } finally {
        setPendingId(null);
      }
    });
  };

  return (
    <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle">
      <CardHeader className="pb-4 border-b border-[#e0e2e8] dark:border-border/60">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base font-semibold tracking-tight flex items-center gap-2">
              <ShieldCheck className="size-4 text-[#4262ff]" aria-hidden="true" />
              Account safety (24h)
            </CardTitle>
            <CardDescription className="text-xs text-[#555a6a] dark:text-muted-foreground">
              Measured from real safety events — not a marketing mockup.
            </CardDescription>
          </div>
          {typeof score === "number" && (
            <div className="text-right">
              <p className={`text-2xl font-bold tracking-tight ${scoreColor}`}>
                {score}
                <span className="text-sm font-medium text-muted-foreground">/100</span>
              </p>
              {band && (
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {band}
                </p>
              )}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-5 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-center">
          {[
            { label: "Rate-limit breaches", value: stats.breaches, tone: stats.breaches > 0 ? "text-destructive" : "text-foreground" },
            { label: "Viral throttles", value: stats.throttles, tone: "text-foreground" },
            { label: "Viral spikes", value: stats.viralSpikes, tone: "text-foreground" },
            { label: "Opt-outs", value: stats.optOuts, tone: "text-foreground" },
            { label: "Gate exceptions", value: stats.exceptions, tone: "text-foreground" },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-[#e0e2e8] dark:border-border py-2">
              <p className={`text-sm font-bold ${item.tone}`}>{item.value}</p>
              <p className="text-[10px] text-muted-foreground">{item.label}</p>
            </div>
          ))}
        </div>

        {accounts.length > 0 && (
          <div className="space-y-2">
            {accounts.map((account) => (
              <div
                key={account.id}
                className="rounded-xl border border-[#e0e2e8] dark:border-border px-3.5 py-3 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="space-y-0.5">
                  <p className="text-xs font-semibold">
                    @{account.username ?? "connected account"}
                  </p>
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                    {account.tokenStatus === "invalid" ? (
                      <span className="text-destructive flex items-center gap-1">
                        <AlertTriangle className="size-3" aria-hidden="true" /> Token needs reconnect
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <CheckCircle2 className="size-3 text-[#00b473]" aria-hidden="true" /> Token healthy
                      </span>
                    )}
                    {account.consecutiveFailures > 0 && (
                      <span>· {account.consecutiveFailures} consecutive failures</span>
                    )}
                    {account.lastError && (
                      <span className="truncate max-w-[200px]">· {account.lastError.slice(0, 60)}</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={account.safetyPaused ? "outline" : "tag-teal"}
                    className="text-[10px] font-semibold rounded-full px-3"
                  >
                    {account.safetyPaused ? "Paused" : "Active"}
                  </Badge>
                  <Button
                    type="button"
                    size="sm"
                    variant={account.safetyPaused ? "default" : "outline"}
                    disabled={isPending && pendingId === account.id}
                    onClick={() => toggle(account.id, !account.safetyPaused)}
                    className="rounded-full text-[11px] h-8 px-3"
                  >
                    {isPending && pendingId === account.id ? (
                      <span role="status" className="flex items-center gap-1">
                        <span className="sr-only">Updating…</span>
                      </span>
                    ) : account.safetyPaused ? (
                      <>
                        <Play className="size-3 mr-1" aria-hidden="true" /> Resume
                      </>
                    ) : (
                      <>
                        <Pause className="size-3 mr-1" aria-hidden="true" /> Pause
                      </>
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <p role="alert" className="text-[11px] font-medium text-destructive">
            {error}
          </p>
        )}
        <p className="text-[10px] text-muted-foreground">
          Pausing stops automated sends for that account until you resume. Nothing is deleted;
          queued DMs wait for the resume. Consecutive failures (5) pause automatically.
        </p>
      </CardContent>
    </Card>
  );
}
