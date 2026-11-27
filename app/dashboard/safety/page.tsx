import { connection } from "next/server";
import { notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/profile";
import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { getQueueStats } from "@/lib/dm-queue";
import { computeSafetyScore } from "@/lib/meta/safety-score";
import { META_PRIVATE_REPLIES_PER_HOUR } from "@/lib/meta/limits";
import { explainSafetyEvent } from "@/lib/safety-event-explanations";
import {
  ShieldCheck,
  Activity,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SafetyCard } from "@/components/dashboard/safety-card";
import { DmQueueCard } from "@/components/dashboard/dm-queue-card";

export const metadata = { title: "Safety — dmplease" };

export default async function SafetyPage() {
  await connection();
  const profile = await getCurrentProfile();
  if (!profile) notFound();
  const ownedWorkspaceIds = (profile.ownedWorkspaces || []).map((w) => w.id);
  if (ownedWorkspaceIds.length === 0) notFound();

  const safetyStats = { breaches: 0, throttles: 0, viralSpikes: 0, optOuts: 0, exceptions: 0 };
  let accountHealth: Array<{
    id: string;
    username: string | null;
    tokenStatus: string | null;
    consecutiveFailures: number;
    safetyPaused: boolean;
    lastError: string | null;
    lastSendAt: string | null;
  }> = [];
  let recentEvents: Array<{ id: string; kind: string; created_at: string; workspace_id: string }> = [];
  let sentLastHour = 0;
  let failedLast24h = 0;
  let sentLast24h = 0;

  if (hasAdminDb()) {
    const db = getAdminDb();
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const since1h = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const [safetyRes, accountsRes, eventsRes, sentHourRes, sentDayRes, failedDayRes] =
      await Promise.all([
        db
          .from("safety_events")
          .select("kind")
          .in("workspace_id", ownedWorkspaceIds)
          .gte("created_at", since24h)
          .limit(5000),
        db
          .from("instagram_accounts")
          .select("id, username, token_status, consecutive_failures, safety_paused, last_error, last_send_at")
          .in("workspace_id", ownedWorkspaceIds),
        db
          .from("safety_events")
          .select("id, kind, created_at, workspace_id")
          .in("workspace_id", ownedWorkspaceIds)
          .order("created_at", { ascending: false })
          .limit(40),
        db
          .from("dm_logs")
          .select("id", { count: "exact", head: true })
          .in("workspace_id", ownedWorkspaceIds)
          .eq("status", "SENT")
          .gte("sent_at", since1h),
        db
          .from("dm_logs")
          .select("id", { count: "exact", head: true })
          .in("workspace_id", ownedWorkspaceIds)
          .eq("status", "SENT")
          .gte("sent_at", since24h),
        db
          .from("dm_logs")
          .select("id", { count: "exact", head: true })
          .in("workspace_id", ownedWorkspaceIds)
          .eq("status", "FAILED")
          .gte("sent_at", since24h),
      ]);

    for (const row of safetyRes.data ?? []) {
      const kind = String(row.kind);
      if (kind === "rate_limit_breach") safetyStats.breaches++;
      else if (kind === "viral_throttle") safetyStats.throttles++;
      else if (kind === "viral_spike") safetyStats.viralSpikes++;
      else if (kind === "opt_out") safetyStats.optOuts++;
      else if (kind === "follow_gate_exception") safetyStats.exceptions++;
    }
    accountHealth = (accountsRes.data ?? []).map((a) => ({
      id: String(a.id),
      username: a.username ? String(a.username) : null,
      tokenStatus: a.token_status ? String(a.token_status) : null,
      consecutiveFailures: Number(a.consecutive_failures ?? 0),
      safetyPaused: Boolean(a.safety_paused),
      lastError: a.last_error ? String(a.last_error) : null,
      lastSendAt: a.last_send_at ? String(a.last_send_at) : null,
    }));
    recentEvents = (eventsRes.data ?? []).map((e) => ({
      id: String(e.id),
      kind: String(e.kind),
      created_at: String(e.created_at),
      workspace_id: String(e.workspace_id),
    }));
    sentLastHour = sentHourRes.count ?? 0;
    sentLast24h = sentDayRes.count ?? 0;
    failedLast24h = failedDayRes.count ?? 0;
  }

  const queueStats = await getQueueStats(ownedWorkspaceIds);

  const primaryAccount = accountHealth[0] ?? null;
  const safetyResult = computeSafetyScore({
    sent24h: sentLast24h,
    failed24h: failedLast24h,
    breaches24h: safetyStats.breaches,
    throttles24h: safetyStats.throttles,
    spikes24h: safetyStats.viralSpikes,
    optOuts24h: safetyStats.optOuts,
    gateExceptions24h: safetyStats.exceptions,
    consecutiveFailures: primaryAccount?.consecutiveFailures ?? 0,
    tokenInvalid: primaryAccount?.tokenStatus === "invalid",
    safetyPaused: primaryAccount?.safetyPaused ?? false,
    staleQueue: queueStats.oldestPendingAt
      ? Date.now() - new Date(queueStats.oldestPendingAt).getTime() > 60 * 60 * 1000
      : false,
  });

  const META_HOURLY_LIMIT = META_PRIVATE_REPLIES_PER_HOUR;
  const sendsPerMinute = Math.round(sentLastHour / 60);
  const metaLimitPerMinute = Math.round(META_HOURLY_LIMIT / 60);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 pb-3 border-b border-[#e0e2e8] dark:border-border/80">
        <div>
          <h1 className="text-lg font-bold text-foreground tracking-tight flex items-center gap-2">
            <ShieldCheck className="size-5 text-[#4262ff]" aria-hidden="true" />
            Safety
          </h1>
          <p className="text-xs text-[#555a6a] dark:text-muted-foreground mt-0.5">
            Measured from real safety events — not a marketing mockup.
          </p>
        </div>
        <Badge
          variant={safetyResult.band === "excellent" || safetyResult.band === "good" ? "tag-teal" : "outline"}
          className="text-xs font-semibold rounded-full px-4"
        >
          Safety score: {safetyResult.score}/100 — {safetyResult.label}
        </Badge>
      </div>

      {/* Score card */}
      <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle">
        <CardHeader className="pb-4 border-b border-[#e0e2e8] dark:border-border/60">
          <CardTitle className="text-base font-semibold tracking-tight">
            Safety score
          </CardTitle>
          <CardDescription className="text-xs text-[#555a6a] dark:text-muted-foreground">
            Composite of delivery rate, breaches, token health, consecutive failures,
            opt-outs and queue health over the last 24 hours.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5 space-y-4">
          <div className="flex items-center gap-4">
            <div className="text-4xl font-bold tracking-tight text-foreground">
              {safetyResult.score}
            </div>
            <div className="flex-1">
              <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full transition-all ${
                    safetyResult.score >= 80
                      ? "bg-[#00b473]"
                      : safetyResult.score >= 60
                        ? "bg-[#4262ff]"
                        : safetyResult.score >= 40
                          ? "bg-amber-500"
                          : "bg-destructive"
                  }`}
                  style={{ width: `${safetyResult.score}%` }}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={safetyResult.score}
                  aria-label="Safety score"
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">{safetyResult.summary}</p>
            </div>
          </div>
          {safetyResult.deductions.length > 0 && (
            <ul className="space-y-1.5 text-[11px]">
              {safetyResult.deductions.map((d, i) => (
                <li key={i} className="flex items-center justify-between gap-2 text-muted-foreground">
                  <span>{d.reason}</span>
                  <span className="font-mono text-destructive">-{d.points}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Live gauge */}
      <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle">
        <CardHeader className="pb-4 border-b border-[#e0e2e8] dark:border-border/60">
          <CardTitle className="text-base font-semibold tracking-tight flex items-center gap-2">
            <Activity className="size-4 text-[#4262ff]" aria-hidden="true" />
            Sends per minute vs Meta limit
          </CardTitle>
          <CardDescription className="text-xs text-[#555a6a] dark:text-muted-foreground">
            Last hour: {sentLastHour} DMs delivered. Meta&apos;s per-account limit is roughly
            {" "}{META_HOURLY_LIMIT}/hour for comment DMs.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5 space-y-3">
          <div className="flex items-end gap-3">
            <div className="text-3xl font-bold tracking-tight text-foreground">
              {sendsPerMinute}
            </div>
            <div className="text-xs text-muted-foreground pb-1">
              / {metaLimitPerMinute} sends per minute (Meta limit)
            </div>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-all ${
                sendsPerMinute > metaLimitPerMinute
                  ? "bg-destructive"
                  : sendsPerMinute > metaLimitPerMinute * 0.8
                    ? "bg-amber-500"
                    : "bg-[#00b473]"
              }`}
              style={{
                width: `${Math.min(100, (sendsPerMinute / metaLimitPerMinute) * 100)}%`,
              }}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={metaLimitPerMinute}
              aria-valuenow={sendsPerMinute}
              aria-label="Sends per minute vs Meta limit"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            {sentLastHour} sent in the last hour · {sentLast24h} sent · {failedLast24h} failed in 24h
          </p>
        </CardContent>
      </Card>

      {/* Queue + account health */}
      <div className="grid gap-6 lg:grid-cols-2">
        <DmQueueCard
          pending={queueStats.pending}
          failed={queueStats.failed}
          oldestPendingAt={queueStats.oldestPendingAt}
        />
        <SafetyCard stats={safetyStats} accounts={accountHealth} />
      </div>

      {/* Recent safety events */}
      <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle">
        <CardHeader className="pb-4 border-b border-[#e0e2e8] dark:border-border/60">
          <CardTitle className="text-base font-semibold tracking-tight">
            Recent safety events
          </CardTitle>
          <CardDescription className="text-xs text-[#555a6a] dark:text-muted-foreground">
            Last 40 events across your workspaces. Every throttle, breach, opt-out and failure is recorded here.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5">
          {recentEvents.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No safety events recorded yet. This is good - it means nothing has been
              throttled or blocked.
            </p>
          ) : (
            <ul className="space-y-2" aria-label="Recent safety events">
              {recentEvents.map((event) => (
                <li
                  key={event.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-[#e0e2e8] dark:border-border px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Badge
                      variant={
                        event.kind === "rate_limit_breach" || event.kind === "opt_out"
                          ? "outline"
                          : "tag-teal"
                      }
                      className="text-[9px] font-semibold rounded-full px-2 py-0.5 shrink-0"
                      title={explainSafetyEvent(event.kind)}
                    >
                      {event.kind}
                    </Badge>
                    <div className="min-w-0">
                      <p className="text-[11px] text-foreground truncate">
                        {explainSafetyEvent(event.kind)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(event.created_at).toLocaleString("en-IN", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
