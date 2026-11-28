import { Suspense } from "react";
import { connection } from "next/server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import {
  TrendingUp,
  Send,
  CheckCircle2,
  Inbox,
  Zap,
  Eye,
  Users,
  BarChart3,
  RefreshCw,
  Trophy,
  TrendingDown,
  Sparkles,
  UserPlus,
  ExternalLink,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import { NumberTicker } from "@/components/ui/number-ticker";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { AnimatedGradientText } from "@/components/ui/animated-gradient-text";
import { BentoGrid } from "@/components/ui/bento-grid";
import { getQueueStats } from "@/lib/dm-queue";
import { computeSafetyScore } from "@/lib/meta/safety-score";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { DmQueueCard } from "@/components/dashboard/dm-queue-card";
import { SafetyCard } from "@/components/dashboard/safety-card";
import { Progress } from "@/components/ui/progress";
import { getCurrentProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { getWebhookHealth } from "@/lib/meta/webhook-events";
import { getWorkspaceAnalytics } from "@/lib/analytics";
import { getReportLink } from "@/app/dashboard/settings/report-actions";
import { getWorkspacePreferences } from "@/lib/workspace-preferences";
import {
  addDaysToDateOnly,
  getTodayInTimeZone,
  zonedTimeToUtc,
} from "@/lib/timezone";
import {
  EMPTY_FOLLOW_PROMPT_STATS,
  summarizeFollowPrompts,
  type FollowPromptRow,
} from "@/lib/follow-analytics";
import {
  buildCampaignInsights,
  computeConversionRate,
  summarizeInsights,
  type InsightRow,
} from "@/lib/insights-analytics";

export const metadata = {
  title: "Analytics & Performance - dmplease",
};

/**
 * Forwards the refresh request to the dedicated insights route, then refreshes
 * the server-rendered figures. Kept as a form action so the button works
 * without adding a client component to this page.
 */
async function refreshInsightsAction() {
  "use server";

  const requestHeaders = await headers();
  const host = requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || "http";
  const cookie = requestHeaders.get("cookie") || "";

  try {
    await fetch(`${protocol}://${host}/api/insights/refresh`, {
      method: "POST",
      headers: { cookie },
      cache: "no-store",
    });
  } catch (error) {
    console.warn("[insights] Refresh request failed:", error);
  }

  revalidatePath("/dashboard/overview");
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6 animate-pulse motion-reduce:animate-none">
      <Skeleton className="h-8 w-64 rounded-xl" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}

interface PageProps {
  searchParams?: Promise<{ range?: string; tab?: string }>;
}

export default function OverviewPage(props: PageProps) {
  // Keep URL data access inside the Suspense boundary so the static shell can
  // be prerendered with Cache Components enabled.
  return (
    <Suspense fallback={<OverviewSkeleton />}>
      <OverviewContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function OverviewContent({ searchParams }: PageProps) {
  const resolvedParams = await searchParams;
  const range = resolvedParams?.range || "all";
  const requestedTab = resolvedParams?.tab || "overview";
  const activeTab = [
    "overview",
    "funnel",
    "revenue",
    "audience",
    "campaigns",
    "accounts",
  ].includes(requestedTab)
    ? requestedTab
    : "overview";

  await connection();
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  const workspaceIds = (profile?.ownedWorkspaces || []).map((w) => w.id);
  const health = await getWebhookHealth(24 * 7, workspaceIds);
  const reportLink = workspaceIds[0]
    ? await getReportLink(workspaceIds[0])
    : null;
  const preferences = workspaceIds[0]
    ? await getWorkspacePreferences(workspaceIds[0])
    : { timezone: "Asia/Kolkata", weekStartsOn: 1 };
  const timeZone = preferences.timezone;
  const analyticsDays = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const analytics = workspaceIds[0]
    ? await getWorkspaceAnalytics(workspaceIds[0], analyticsDays, timeZone)
    : null;

  interface OverviewLog {
    id: string;
    trigger_keyword: string | null;
    keyword: string | null;
    status: string | null;
    sent_at: string | null;
    automation_id: string | null;
    instagram_account_id: string | null;
    post_id: string | null;
    sequence_step: number | null;
  }
  let logs: OverviewLog[] = [];
  let totalDms = 0;
  let deliveredDms = 0;
  const keywordCounts: Record<string, number> = {};
  let periodCutoff: string | null = null;

  if (workspaceIds.length > 0) {
    let query = supabase
      .from("dm_logs")
      .select(
        "id, trigger_keyword, keyword, status, sent_at, automation_id, instagram_account_id, post_id, sequence_step",
        { count: "exact" }
      )
      .in("workspace_id", workspaceIds);

    const today = getTodayInTimeZone(timeZone);
    if (range === "7d") {
      periodCutoff = zonedTimeToUtc(
        addDaysToDateOnly(today, -6),
        timeZone
      ).toISOString();
      query = query.gte("sent_at", periodCutoff);
    } else if (range === "30d") {
      periodCutoff = zonedTimeToUtc(
        addDaysToDateOnly(today, -29),
        timeZone
      ).toISOString();
      query = query.gte("sent_at", periodCutoff);
    }

    const { data: logRows, count } = await query;
    logs = (logRows as OverviewLog[] | null) ?? [];

    totalDms = count || 0;

    if (logs) {
      for (const log of logs) {
        if (log.status === "SENT" || log.status === "Delivered" || !log.status) {
          deliveredDms++;
        }
        if (log.trigger_keyword) {
          const kw = log.trigger_keyword.toUpperCase().trim();
          keywordCounts[kw] = (keywordCounts[kw] || 0) + 1;
        }
      }
    }
  }

  const deliveryRate =
    totalDms > 0 ? Math.round((deliveredDms / totalDms) * 100) : null;

  // ── Phase A funnel signals ──────────────────────────────────────────────
  const scopedInPeriod = <T,>(q: T) =>
    periodCutoff ? (q as { gte: (c: string, v: string) => T }).gte("created_at", periodCutoff) : q;

  let triggerComments = 0;
  let openingMessages = 0;
  let linkClicks = 0;
  let leadsCaptured = 0;
  interface ConversionRow {
    type: string;
    revenue_minor: number;
    currency: string;
    keyword: string | null;
    post_id: string | null;
    contact_id: string | null;
    automation_id: string | null;
    sequence_step: number;
    occurred_at: string;
  }
  let conversionRows: ConversionRow[] = [];

  if (workspaceIds.length > 0) {
    const [commentsRes, openingLogRes, clicksRes, contactsRes, conversionsRes] = await Promise.all([
      scopedInPeriod(
        supabase
          .from("comment_events")
          .select("id", { count: "exact", head: true })
          .in("workspace_id", workspaceIds)
      ),
      // Count *sent* openers, not outstanding opt-in records (a pending row is
      // created before the Meta call and is deleted again when that call fails).
      periodCutoff
        ? supabase
            .from("dm_logs")
            .select("id", { count: "exact", head: true })
            .in("workspace_id", workspaceIds)
            .eq("trigger_keyword", "OPENING")
            .eq("status", "SENT")
            .gte("sent_at", periodCutoff)
        : supabase
            .from("dm_logs")
            .select("id", { count: "exact", head: true })
            .in("workspace_id", workspaceIds)
            .eq("trigger_keyword", "OPENING")
            .eq("status", "SENT"),
      periodCutoff
        ? supabase
            .from("link_clicks")
            .select("id", { count: "exact", head: true })
            .in("workspace_id", workspaceIds)
            .eq("is_bot", false)
            .gte("clicked_at", periodCutoff)
        : supabase
            .from("link_clicks")
            .select("id", { count: "exact", head: true })
            .in("workspace_id", workspaceIds)
            .eq("is_bot", false),
      scopedInPeriod(
        supabase
          .from("contacts")
          .select("id", { count: "exact", head: true })
          .in("workspace_id", workspaceIds)
      ),
      periodCutoff
        ? supabase
            .from("conversions")
            .select("type, revenue_minor, currency, keyword, post_id, contact_id, automation_id, sequence_step, occurred_at")
            .in("workspace_id", workspaceIds)
            .gte("occurred_at", periodCutoff)
        : supabase
            .from("conversions")
            .select("type, revenue_minor, currency, keyword, post_id, contact_id, automation_id, sequence_step, occurred_at")
            .in("workspace_id", workspaceIds),
    ]);
    triggerComments = commentsRes.count ?? 0;
    openingMessages = openingLogRes.count ?? 0;
    linkClicks = clicksRes.count ?? 0;
    leadsCaptured = contactsRes.count ?? 0;
    conversionRows = (conversionsRes.data as ConversionRow[] | null) ?? [];
  }

  const queueStats = await getQueueStats(workspaceIds);

  // Safety score inputs (24h window).
  let sentLast24h = 0;
  let failedLast24h = 0;
  if (workspaceIds.length > 0) {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [sentRes, failedRes] = await Promise.all([
      supabase
        .from("dm_logs")
        .select("id", { count: "exact", head: true })
        .in("workspace_id", workspaceIds)
        .eq("status", "SENT")
        .gte("sent_at", since24h),
      supabase
        .from("dm_logs")
        .select("id", { count: "exact", head: true })
        .in("workspace_id", workspaceIds)
        .eq("status", "FAILED")
        .gte("sent_at", since24h),
    ]);
    sentLast24h = sentRes.count ?? 0;
    failedLast24h = failedRes.count ?? 0;
  }

  interface AccountHealthView {
    id: string;
    username: string | null;
    tokenStatus: string | null;
    consecutiveFailures: number;
    safetyPaused: boolean;
    lastError: string | null;
    lastSendAt: string | null;
  }
  const safetyStats = { breaches: 0, throttles: 0, viralSpikes: 0, optOuts: 0, exceptions: 0 };
  let accountHealth: AccountHealthView[] = [];
  if (workspaceIds.length > 0) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: safetyRows } = await supabase
      .from("safety_events")
      .select("kind")
      .in("workspace_id", workspaceIds)
      .gte("created_at", since)
      .limit(5000);
    for (const row of safetyRows ?? []) {
      const kind = String(row.kind);
      if (kind === "rate_limit_breach") safetyStats.breaches++;
      else if (kind === "viral_throttle") safetyStats.throttles++;
      else if (kind === "viral_spike") safetyStats.viralSpikes++;
      else if (kind === "opt_out") safetyStats.optOuts++;
      else if (kind === "follow_gate_exception") safetyStats.exceptions++;
    }
    const { data: accounts } = await supabase
      .from("instagram_accounts")
      .select("id, username, token_status, consecutive_failures, safety_paused, last_error, last_send_at")
      .in("workspace_id", workspaceIds);
    accountHealth = (accounts ?? []).map((account) => ({
      id: String(account.id),
      username: account.username ? String(account.username) : null,
      tokenStatus: account.token_status ? String(account.token_status) : null,
      consecutiveFailures: Number(account.consecutive_failures ?? 0),
      safetyPaused: Boolean(account.safety_paused),
      lastError: account.last_error ? String(account.last_error) : null,
      lastSendAt: account.last_send_at ? String(account.last_send_at) : null,
    }));
  }

  const safetyResult = computeSafetyScore({
    sent24h: sentLast24h,
    failed24h: failedLast24h,
    breaches24h: safetyStats.breaches,
    throttles24h: safetyStats.throttles,
    spikes24h: safetyStats.viralSpikes,
    optOuts24h: safetyStats.optOuts,
    gateExceptions24h: safetyStats.exceptions,
    consecutiveFailures: accountHealth[0]?.consecutiveFailures ?? 0,
    tokenInvalid: accountHealth[0]?.tokenStatus === "invalid",
    safetyPaused: accountHealth[0]?.safetyPaused ?? false,
    staleQueue: queueStats.oldestPendingAt
      ? Date.now() - new Date(queueStats.oldestPendingAt).getTime() > 60 * 60 * 1000
      : false,
  });

  const revenueMinor = conversionRows.reduce(
    (sum, row) => sum + Number(row.revenue_minor ?? 0),
    0
  );
  const purchases = conversionRows.filter(
    (row) => row.type === "purchase" || row.type === "checkout"
  ).length;
  const currency = conversionRows.find((row) => row.currency)?.currency ?? "INR";
  const revenueLabel =
    revenueMinor > 0
      ? `${currency} ${(revenueMinor / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
      : null;

  const revenueByCreative = new Map<string, { revenue: number; count: number }>();
  for (const row of conversionRows) {
    if (!row.post_id && !row.keyword) continue;
    const key = row.keyword
      ? `${row.keyword}${row.post_id ? ` · ${row.post_id.slice(-6)}` : ""}`
      : `Post · ${String(row.post_id).slice(-6)}`;
    const current = revenueByCreative.get(key) ?? { revenue: 0, count: 0 };
    current.revenue += Number(row.revenue_minor ?? 0);
    current.count += 1;
    revenueByCreative.set(key, current);
  }
  const topCreatives = Array.from(revenueByCreative.entries())
    .map(([label, value]) => ({ label, ...value }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  const conversionContactCounts = new Map<string, number>();
  for (const row of conversionRows) {
    if (!row.contact_id) continue;
    conversionContactCounts.set(
      row.contact_id,
      (conversionContactCounts.get(row.contact_id) ?? 0) + 1
    );
  }
  const repeatBuyers = Array.from(conversionContactCounts.values()).filter(
    (count) => count > 1
  ).length;

  // Per-account breakdown (DMs, delivery, conversions).
  const accountStats = new Map<
    string,
    { dms: number; failed: number; conversions: number }
  >();
  const automationAccount = new Map<string, string>();
  for (const log of logs) {
    if (!log.instagram_account_id) continue;
    const entry =
      accountStats.get(log.instagram_account_id) ?? {
        dms: 0,
        failed: 0,
        conversions: 0,
      };
    if (log.status === "SENT" || log.status === "Delivered" || !log.status) {
      entry.dms++;
    }
    if (log.status === "FAILED") entry.failed++;
    accountStats.set(log.instagram_account_id, entry);
    if (log.automation_id && !automationAccount.has(log.automation_id)) {
      automationAccount.set(log.automation_id, log.instagram_account_id);
    }
  }
  for (const row of conversionRows) {
    if (!row.automation_id) continue;
    const accountId = automationAccount.get(row.automation_id);
    if (!accountId) continue;
    const entry = accountStats.get(accountId);
    if (entry) entry.conversions++;
  }
  const accountNameById = new Map(
    accountHealth.map((account) => [account.id, account.username])
  );
  const accountBreakdown = [...accountStats.entries()]
    .map(([id, value]) => ({
      id,
      username: accountNameById.get(id) ?? null,
      dms: value.dms,
      deliveryRate:
        value.dms + value.failed > 0
          ? Math.round((value.dms / (value.dms + value.failed)) * 100)
          : null,
      conversions: value.conversions,
    }))
    .sort((a, b) => b.dms - a.dms);

  // Follower growth attributed to in-chat "Ask to follow" prompts.
  let followStats = EMPTY_FOLLOW_PROMPT_STATS;
  if (workspaceIds.length > 0) {
    const since = new Date(Date.now() - analyticsDays * 86400000).toISOString();
    const { data: promptRows } = await supabase
      .from("follow_prompts")
      .select("id, status, prior_follower, created_at, tapped_at, resolved_at, delivered_at")
      .in("workspace_id", workspaceIds)
      .gte("created_at", since)
      .limit(2000);
    followStats = summarizeFollowPrompts(
      (promptRows ?? []) as FollowPromptRow[],
      analyticsDays
    );
  }

  const sentLogs = (logs ?? []).filter(
    (log) => log.status === "SENT" || log.status === "Delivered" || !log.status
  );
  const confirmedOptins = sentLogs.filter(
    (log) => Number(log.sequence_step ?? 1) > 1
  ).length;
  const deliveredInPeriod = sentLogs.length;

  const automationNames = new Map(
    allAutomationsNow().map((auto) => [auto.id, auto.name])
  );
  function allAutomationsNow() {
    return (profile?.ownedWorkspaces || []).flatMap((w) => w.automations || []);
  }

  const byAutomation = new Map<string, number>();
  for (const log of sentLogs) {
    if (!log.automation_id) continue;
    byAutomation.set(
      log.automation_id,
      (byAutomation.get(log.automation_id) ?? 0) + 1
    );
  }
  const topAutomationEntry = Array.from(byAutomation.entries()).sort(
    (a, b) => b[1] - a[1]
  )[0];
  const topAutomation = topAutomationEntry
    ? {
        id: topAutomationEntry[0],
        name: automationNames.get(topAutomationEntry[0]) ?? "Campaign",
        count: topAutomationEntry[1],
      }
    : null;

  const funnelSteps = [
    { label: "Comments matched", value: triggerComments, href: "/dashboard/campaigns" },
    { label: "DMs delivered", value: deliveredInPeriod, href: "/dashboard/diagnostics" },
    { label: "Opening messages sent", value: openingMessages, href: "/dashboard/campaigns" },
    { label: "Opt-ins confirmed", value: confirmedOptins, href: "/dashboard/campaigns" },
    { label: "Links clicked", value: linkClicks, href: "/dashboard/overview" },
    { label: "Leads captured", value: leadsCaptured, href: "/dashboard/contacts" },
  ];

  const leakMessages: Record<number, { label: string; detail: string; href: string }> = {
    0: {
      label: "Comments aren't becoming DMs",
      detail: "Check delivery failures, rate limits and keyword scopes.",
      href: "/dashboard/diagnostics",
    },
    1: {
      label: "Follow-gate is skipping people",
      detail: "Try a campaign without the gate for seven days.",
      href: "/dashboard/campaigns",
    },
    2: {
      label: "Followers aren't tapping the button",
      detail: "Shorten the opening message and make the CTA clearer.",
      href: "/dashboard/campaigns",
    },
    3: {
      label: "Clicks aren't tracked on real links",
      detail: "Add conversion tracking to attribute clicks and purchases.",
      href: "/dashboard/overview",
    },
    4: {
      label: "Clicks aren't becoming leads",
      detail: "Improve the destination page or lead-capture step.",
      href: "/dashboard/campaigns",
    },
  };
  let biggestLeak = leakMessages[4];
  let worstDrop = -1;
  for (let i = 0; i < funnelSteps.length - 1; i++) {
    const from = funnelSteps[i].value;
    const to = funnelSteps[i + 1].value;
    if (from <= 0) continue;
    const drop = 1 - to / from;
    if (drop > worstDrop && drop > 0.2) {
      worstDrop = drop;
      biggestLeak = leakMessages[i] ?? biggestLeak;
    }
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const weeklySent = (logs ?? []).filter(
    (log) => log.sent_at && log.sent_at >= sevenDaysAgo
  ).length;

  const sortedKeywords = Object.entries(keywordCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([keyword, count]) => {
      const share = totalDms > 0 ? Math.round((count / totalDms) * 100) : 0;
      return { keyword, count, share: `${share}%` };
    });

  const allAutomations = (profile?.ownedWorkspaces || []).flatMap(
    (w) => w.automations || []
  );
  const activeKeywords = Array.from(
    new Set(allAutomations.flatMap((a) => a.triggerKeywords || []))
  );

  // ── Meta insights snapshots (last 30 days) ──────────────────────────────
  let insightRows: InsightRow[] = [];
  let insightsStatus: "unknown" | "ok" | "needs_access" | "error" = "unknown";
  let insightsLastSyncedAt: string | null = null;
  let insightsError: string | null = null;

  if (workspaceIds.length > 0) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000)
      .toISOString()
      .slice(0, 10);

    const [snapshotsRes, accountRes] = await Promise.all([
      supabase
        .from("insight_snapshots")
        .select("metric, value, day, media_id, scope, product_type, permalink, caption")
        .in("workspace_id", workspaceIds)
        .gte("day", thirtyDaysAgo),
      supabase
        .from("instagram_accounts")
        .select("insights_status, insights_last_synced_at, insights_error")
        .in("workspace_id", workspaceIds)
        .limit(1)
        .maybeSingle(),
    ]);

    if (snapshotsRes.error) {
      console.warn("[overview] Could not load insights:", snapshotsRes.error.message);
    } else {
      insightRows = (snapshotsRes.data as InsightRow[] | null) ?? [];
    }

    if (accountRes.data) {
      const status = String(accountRes.data.insights_status ?? "unknown");
      insightsStatus =
        status === "ok" || status === "needs_access" || status === "error"
          ? status
          : "unknown";
      insightsLastSyncedAt = accountRes.data.insights_last_synced_at
        ? String(accountRes.data.insights_last_synced_at)
        : null;
      insightsError = accountRes.data.insights_error
        ? String(accountRes.data.insights_error)
        : null;
    }
  }

  const insightsSummary = summarizeInsights(insightRows);
  const insightTotals = insightsSummary.totals;
  const conversionRateValue = computeConversionRate(
    totalDms,
    insightTotals.impressions
  );
  const conversionRate =
    conversionRateValue === null ? null : conversionRateValue.toFixed(1);

  // Per-campaign conversion: join each automation's post to its media insights.
  const dmCountsByAutomation = new Map<string, number>();
  for (const log of logs) {
    if (!log.automation_id) continue;
    dmCountsByAutomation.set(
      log.automation_id,
      (dmCountsByAutomation.get(log.automation_id) ?? 0) + 1
    );
  }
  const campaignInsights = buildCampaignInsights(
    allAutomations.map((automation) => ({
      id: automation.id,
      name: automation.name,
      postId: automation.postId ?? null,
    })),
    insightsSummary.media,
    dmCountsByAutomation
  ).slice(0, 5);

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "funnel", label: "Funnel" },
    { id: "revenue", label: "Revenue" },
    { id: "audience", label: "Audience" },
    { id: "campaigns", label: "Campaigns" },
    { id: "accounts", label: "Accounts" },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-300 antialiased selection:bg-brand selection:text-brand-foreground">
      {/* ── Header ── */}
      <header className="flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Insights
          </p>
          <h1 className="mt-1 text-balance text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            <AnimatedGradientText>Insights</AnimatedGradientText>
          </h1>
          <p className="mt-1 max-w-2xl text-pretty text-sm text-muted-foreground">
            Performance and AI insights for{" "}
            {accountHealth[0]?.username
              ? `@${accountHealth[0].username}`
              : "your workspace"}
            {insightsLastSyncedAt
              ? ` · Updated ${new Date(insightsLastSyncedAt).toLocaleString(
                  "en-IN",
                  {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone,
                  }
                )}`
              : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex w-fit items-center gap-1.5 rounded-full border border-border bg-muted p-1">
            {[
              { id: "7d", label: "7 Days" },
              { id: "30d", label: "30 Days" },
              { id: "all", label: "All Time" },
            ].map((option) => (
              <Link
                key={option.id}
                href={`/dashboard/overview?range=${option.id}&tab=${activeTab}`}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-[background-color,color,box-shadow] ${
                  range === option.id
                    ? "bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {option.label}
              </Link>
            ))}
          </div>
          {reportLink?.enabled ? (
            <ShimmerButton
              href={`/report/${reportLink.token}`}
              target="_blank"
              rel="noreferrer"
              className="h-9 px-4 text-xs"
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
              Share report
            </ShimmerButton>
          ) : (
            <ShimmerButton href="/dashboard/settings" className="h-9 px-4 text-xs">
              <ExternalLink className="size-3.5" aria-hidden="true" />
              Create report link
            </ShimmerButton>
          )}
          <form action={refreshInsightsAction}>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              className="h-9 rounded-full px-4 text-xs font-semibold"
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Refresh insights
            </Button>
          </form>
        </div>
      </header>

      {insightsStatus === "needs_access" && (
        <div
          role="alert"
          className="rounded-2xl border border-amber-400/50 bg-amber-50/70 p-4 dark:bg-amber-950/20"
        >
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              <BarChart3 className="size-4" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">
                Insights access needed
              </p>
              <p className="max-w-2xl text-xs text-muted-foreground">
                {insightsError ??
                  "Meta did not grant instagram_manage_insights. Reconnect your Instagram account and approve Insights access to see reach, impressions and conversion rates."}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Account summary metrics ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SpotlightCard
          className="border-info/30 bg-info-soft/40 p-5 dark:bg-info/10"
          spotlightColor="hsl(var(--info) / 0.2)"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-info-soft-foreground dark:text-info-soft-foreground">
              Reach
            </span>
            <Users className="size-4 text-info" aria-hidden="true" />
          </div>
          <p className="mt-3 text-2xl font-bold tabular-nums text-foreground">
            <NumberTicker value={insightTotals.reach} />
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Unique accounts reached
          </p>
        </SpotlightCard>

        <SpotlightCard
          className="border-success/30 bg-success-soft/30 p-5 dark:bg-success/10"
          spotlightColor="hsl(var(--success) / 0.2)"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-success-soft-foreground dark:text-success-soft-foreground">
              Impressions
            </span>
            <Eye className="size-4 text-success" aria-hidden="true" />
          </div>
          <p className="mt-3 text-2xl font-bold tabular-nums text-foreground">
            <NumberTicker value={insightTotals.impressions} />
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Total views in the period
          </p>
        </SpotlightCard>

        <SpotlightCard
          className="border-rose/40 bg-rose-soft/30 p-5 dark:bg-rose/10"
          spotlightColor="hsl(var(--rose) / 0.24)"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-rose-soft-foreground dark:text-rose">
              Profile views
            </span>
            <BarChart3 className="size-4 text-rose-soft-foreground dark:text-rose" aria-hidden="true" />
          </div>
          <p className="mt-3 text-2xl font-bold tabular-nums text-foreground">
            <NumberTicker value={insightTotals.profileViews} />
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Visits to your profile
          </p>
        </SpotlightCard>

        <SpotlightCard
          className="border-brand/30 bg-brand-soft/40 p-5 dark:bg-brand/10"
          spotlightColor="hsl(var(--brand) / 0.22)"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-brand-soft-foreground dark:text-brand">
              Conversion rate
            </span>
            <TrendingUp className="size-4 text-brand-soft-foreground dark:text-brand" aria-hidden="true" />
          </div>
          <p className="mt-3 text-2xl font-bold tabular-nums text-foreground">
            {conversionRate === null ? (
              "—"
            ) : (
              <NumberTicker value={Number(conversionRate)} suffix="%" decimals={1} />
            )}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {insightTotals.impressions > 0
              ? `${totalDms.toLocaleString("en-IN")} DMs ÷ ${insightTotals.impressions.toLocaleString("en-IN")} impressions`
              : "No impressions recorded yet"}
          </p>
        </SpotlightCard>
      </div>

      {/* ── Section tabs ── */}
      <nav
        aria-label="Insights sections"
        className="flex w-fit max-w-full flex-wrap items-center gap-1.5 rounded-full border border-border bg-muted p-1"
      >
        {tabs.map((item) => (
          <Link
            key={item.id}
            href={`/dashboard/overview?range=${range}&tab=${item.id}`}
            aria-current={activeTab === item.id ? "page" : undefined}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-[background-color,color,box-shadow] ${
              activeTab === item.id
                ? "bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {/* ── Overview ── */}
      {activeTab === "overview" && (
        <div className="space-y-5">
          <BentoGrid className="grid-cols-1 md:grid-cols-3">
            <SpotlightCard
              className="space-y-3 border-brand/40 bg-brand-soft/40 p-5 dark:bg-brand/10"
              spotlightColor="hsl(var(--brand) / 0.22)"
            >
              <div className="flex items-center gap-2 text-xs font-semibold text-brand-soft-foreground dark:text-brand">
                <Trophy className="size-4" aria-hidden="true" /> Top performer
              </div>
              <p className="text-lg font-semibold tracking-tight text-foreground">
                {topAutomation ? topAutomation.name : "No campaign data yet"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {topAutomation
                  ? `${topAutomation.count} DMs delivered in this period · Edit the winner`
                  : "Publish a campaign and comment your keyword to see results here."}
              </p>
              {topAutomation && (
                <Button asChild variant="outline" size="sm" className="h-8 rounded-full text-[11px]">
                  <Link href={`/dashboard/campaigns/${topAutomation.id}/edit`}>
                    Duplicate flow
                  </Link>
                </Button>
              )}
            </SpotlightCard>

            <SpotlightCard
              className="space-y-3 border-coral/40 bg-coral-soft/40 p-5 dark:bg-coral/10"
              spotlightColor="hsl(var(--coral) / 0.22)"
            >
              <div className="flex items-center gap-2 text-xs font-semibold text-coral-soft-foreground dark:text-coral-soft">
                <TrendingDown className="size-4" aria-hidden="true" /> Biggest leak
              </div>
              <p className="text-lg font-semibold tracking-tight text-foreground">
                {biggestLeak.label}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {worstDrop > 0
                  ? `${Math.round(worstDrop * 100)}% drop at this step. ${biggestLeak.detail}`
                  : biggestLeak.detail}
              </p>
              <Button asChild variant="outline" size="sm" className="h-8 rounded-full text-[11px]">
                <Link href={biggestLeak.href}>Fix it</Link>
              </Button>
            </SpotlightCard>

            <SpotlightCard
              className="space-y-3 border-success/30 bg-success-soft/40 p-5 dark:bg-success/10"
              spotlightColor="hsl(var(--success) / 0.2)"
            >
              <div className="flex items-center gap-2 text-xs font-semibold text-success-soft-foreground dark:text-success-soft-foreground">
                <Sparkles className="size-4" aria-hidden="true" /> This week
              </div>
              <p className="text-lg font-semibold tracking-tight text-foreground">
                {revenueLabel ?? `${weeklySent} DMs · ${leadsCaptured} leads`}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {revenueLabel
                  ? `${purchases} tracked purchases · ${repeatBuyers} repeat buyers`
                  : `${confirmedOptins} opt-ins · ${linkClicks} tracked clicks — add your conversion token in Settings to see revenue`}
              </p>
              <Button asChild variant="outline" size="sm" className="h-8 rounded-full text-[11px]">
                <Link href="/dashboard/campaigns">View campaigns</Link>
              </Button>
            </SpotlightCard>
          </BentoGrid>

          <BentoGrid className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            <SpotlightCard
              className="border-success/30 bg-success-soft/30 p-5 dark:bg-success/10"
              spotlightColor="hsl(var(--success) / 0.2)"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-success-soft-foreground dark:text-success-soft-foreground">
                  Delivery success
                </span>
                <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
              </div>
              <p className="mt-3 text-2xl font-bold tabular-nums text-foreground">
                {deliveryRate === null ? "—" : <NumberTicker value={deliveryRate} suffix="%" />}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {totalDms > 0
                  ? `${deliveredDms.toLocaleString("en-IN")} of ${totalDms.toLocaleString("en-IN")} delivered`
                  : "No deliveries in this period"}
              </p>
            </SpotlightCard>

            <SpotlightCard
              className="border-brand/30 bg-brand-soft/40 p-5 dark:bg-brand/10"
              spotlightColor="hsl(var(--brand) / 0.22)"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-brand-soft-foreground dark:text-brand">
                  Total messages
                </span>
                <Send className="size-4 text-brand-soft-foreground dark:text-brand" aria-hidden="true" />
              </div>
              <p className="mt-3 text-2xl font-bold tabular-nums text-foreground">
                <NumberTicker value={totalDms} />
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Comment-triggered direct messages
              </p>
            </SpotlightCard>

            <SpotlightCard
              className="border-rose/40 bg-rose-soft/30 p-5 dark:bg-rose/10"
              spotlightColor="hsl(var(--rose) / 0.24)"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-rose-soft-foreground dark:text-rose">
                  Processing time
                </span>
                <Zap className="size-4 text-rose-soft-foreground dark:text-rose" aria-hidden="true" />
              </div>
              <p className="mt-3 text-2xl font-bold tabular-nums text-foreground">
                {health.available && health.avgDurationMs !== null
                  ? `${health.avgDurationMs} ms`
                  : "—"}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {health.available && health.total > 0
                  ? `${health.successRate ?? 0}% success over ${health.total} jobs`
                  : "No deliveries measured in the last 7 days"}
              </p>
            </SpotlightCard>

            <SpotlightCard
              className="border-coral/30 bg-coral-soft/30 p-5 dark:bg-coral/10"
              spotlightColor="hsl(var(--coral) / 0.22)"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-coral-soft-foreground dark:text-coral-soft">
                  Leads captured
                </span>
                <UserPlus className="size-4 text-coral-soft-foreground dark:text-coral-soft" aria-hidden="true" />
              </div>
              <p className="mt-3 text-2xl font-bold tabular-nums text-foreground">
                <NumberTicker value={leadsCaptured} />
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Contacts created from automations
              </p>
            </SpotlightCard>
          </BentoGrid>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="rounded-3xl">
              <CardHeader className="border-b border-border pb-4">
                <CardTitle className="text-base font-semibold tracking-tight">
                  Reach trend
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Daily reach from Meta insights · last {analyticsDays} days
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-5">
                {insightsSummary.daily.length > 0 ? (
                  <div
                    className="flex h-32 items-end gap-1"
                    role="img"
                    aria-label={`Daily reach for the last ${insightsSummary.daily.length} days`}
                  >
                    {insightsSummary.daily.map((point) => {
                      const max = Math.max(
                        ...insightsSummary.daily.map((p) => p.reach),
                        1
                      );
                      const height = Math.max(4, Math.round((point.reach / max) * 100));
                      return (
                        <div
                          key={point.day}
                          className="min-w-[3px] flex-1 rounded-t bg-info/70"
                          style={{ height: `${height}%` }}
                          title={`${point.day}: ${point.reach.toLocaleString("en-IN")} reach`}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <div className="py-10 text-center">
                    <BarChart3 className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
                    <p className="mt-2 text-sm font-semibold text-foreground">
                      Insights will appear after the daily refresh
                    </p>
                    <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                      Connect an Instagram account with insights access. Snapshots are recorded once a day.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-3xl">
              <CardHeader className="border-b border-border pb-4">
                <CardTitle className="text-base font-semibold tracking-tight">
                  Conversion funnel
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Every step uses real stored events, not estimates.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 pt-5">
                {funnelSteps.map((step, index) => {
                  const previous = index > 0 ? funnelSteps[index - 1].value : null;
                  const rate =
                    previous && previous > 0
                      ? Math.round((step.value / previous) * 100)
                      : null;
                  const width =
                    funnelSteps[0].value > 0
                      ? Math.max(4, (step.value / funnelSteps[0].value) * 100)
                      : 4;
                  return (
                    <div key={step.label} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <Link
                          href={step.href}
                          className="font-semibold text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                          {step.label}
                        </Link>
                        <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                          {step.value.toLocaleString("en-IN")}
                          {rate !== null ? ` · ${rate}%` : ""}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-brand transition-[width] duration-500"
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>

          <Card className="rounded-3xl">
            <CardHeader className="border-b border-border pb-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base font-semibold tracking-tight">
                    Keyword ingestion leaderboard
                  </CardTitle>
                  <CardDescription className="mt-0.5 text-xs text-muted-foreground">
                    Distribution of comment keywords generating automated DM funnels
                  </CardDescription>
                </div>
                <Badge variant="outline" className="rounded-full px-3 text-[10px] font-semibold">
                  {sortedKeywords.length} active triggers
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-5">
              {sortedKeywords.length > 0 ? (
                <div className="space-y-4">
                  {sortedKeywords.map((kw) => (
                    <div key={kw.keyword} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="rounded-full bg-primary px-2.5 py-1 font-mono text-xs font-medium text-primary-foreground">
                          {kw.keyword}
                        </span>
                        <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
                          {kw.count} triggers ({kw.share})
                        </span>
                      </div>
                      <Progress value={parseInt(kw.share) || 0} className="h-2" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-10 text-center">
                  <Inbox className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
                  <p className="mt-2 text-sm font-semibold text-foreground">
                    No keyword data recorded yet
                  </p>
                  <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                    {activeKeywords.length > 0
                      ? `Active listening keywords: ${activeKeywords.join(", ")}. When followers comment these words, statistics appear here.`
                      : "Create your first comment-to-DM campaign to start tracking keyword performance."}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Funnel ── */}
      {activeTab === "funnel" && (
        <div className="space-y-5">
          <Card className="rounded-3xl">
            <CardHeader className="border-b border-border pb-4">
              <CardTitle className="text-base font-semibold tracking-tight">
                Full conversion funnel
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Comments → DMs → opt-ins → clicks → leads. Instagram does not expose DM opens, so delivery and clicks are the measurable steps.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-5">
              {funnelSteps.map((step, index) => {
                const previous = index > 0 ? funnelSteps[index - 1].value : null;
                const rate =
                  previous && previous > 0
                    ? Math.round((step.value / previous) * 100)
                    : null;
                const width =
                  funnelSteps[0].value > 0
                    ? Math.max(4, (step.value / funnelSteps[0].value) * 100)
                    : 4;
                return (
                  <div key={step.label} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <Link
                        href={step.href}
                        className="font-semibold text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        {step.label}
                      </Link>
                      <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                        {step.value.toLocaleString("en-IN")}
                        {rate !== null ? ` · ${rate}% of previous` : ""}
                      </span>
                    </div>
                    <div className="h-3 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-brand transition-[width] duration-500"
                        style={{ width: `${width}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="rounded-3xl border-coral/40 bg-coral-soft/30 dark:bg-coral/10">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-semibold tracking-tight">
                  <TrendingDown className="size-4 text-coral-soft-foreground dark:text-coral-soft" aria-hidden="true" />
                  Biggest leak
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-lg font-semibold text-foreground">
                  {biggestLeak.label}
                </p>
                <p className="text-xs text-muted-foreground">
                  {worstDrop > 0
                    ? `${Math.round(worstDrop * 100)}% drop at this step. ${biggestLeak.detail}`
                    : biggestLeak.detail}
                </p>
                <Button asChild variant="outline" size="sm" className="h-8 rounded-full text-[11px]">
                  <Link href={biggestLeak.href}>Fix it</Link>
                </Button>
              </CardContent>
            </Card>

            <Card className="rounded-3xl">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-semibold tracking-tight">
                  <UserPlus className="size-4 text-info" aria-hidden="true" />
                  Follower growth from in-chat prompts
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "New followers", value: followStats.newFollowers },
                    { label: "Prompts sent", value: followStats.sent },
                    {
                      label: "Tap rate",
                      value: followStats.tapRate === null ? "—" : `${followStats.tapRate}%`,
                    },
                    { label: "Content delivered", value: followStats.delivered },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="rounded-2xl border border-border bg-muted/40 p-3.5"
                    >
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {item.label}
                      </p>
                      <p className="mt-1.5 text-2xl font-bold tabular-nums text-foreground">
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="rounded-3xl">
            <CardHeader className="border-b border-border pb-4">
              <CardTitle className="text-base font-semibold tracking-tight">
                Daily conversion rollup
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Daily rollups plus today&apos;s live counters from Redis — last {analyticsDays} days.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-5">
              {!analytics || analytics.summary.dmSent === 0 ? (
                <p role="status" className="py-4 text-center text-xs text-muted-foreground">
                  No conversion events yet. They appear here as soon as a DM is sent or a tracked link is clicked.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {[
                    { label: "DMs sent", value: analytics.summary.dmSent.toLocaleString("en-IN"), hint: "Automated deliveries" },
                    { label: "Link clicks", value: analytics.summary.dmLinkClicks.toLocaleString("en-IN"), hint: `${analytics.summary.dmCtrPct}% click-through` },
                    { label: "Follower replies", value: analytics.summary.dmReplies.toLocaleString("en-IN"), hint: `${analytics.summary.dmReplyRatePct}% reply rate` },
                    { label: "Bio clicks", value: analytics.summary.bioClicks.toLocaleString("en-IN"), hint: "Link-in-bio clicks" },
                  ].map((item) => (
                    <div key={item.label} className="space-y-1 rounded-2xl border border-border p-4">
                      <p className="text-[11px] font-semibold text-muted-foreground">{item.label}</p>
                      <p className="text-2xl font-bold tabular-nums text-foreground">{item.value}</p>
                      <p className="text-[10px] text-muted-foreground">{item.hint}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Revenue ── */}
      {activeTab === "revenue" && (
        <div className="space-y-5">
          <BentoGrid className="grid-cols-1 sm:grid-cols-3">
            <SpotlightCard
              className="border-brand/30 bg-brand-soft/40 p-5 dark:bg-brand/10"
              spotlightColor="hsl(var(--brand) / 0.22)"
            >
              <p className="text-xs font-semibold text-brand-soft-foreground dark:text-brand">
                Tracked revenue
              </p>
              <p className="mt-3 text-2xl font-bold tabular-nums text-foreground">
                {revenueLabel ?? "—"}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Server-verified conversions only
              </p>
            </SpotlightCard>
            <SpotlightCard
              className="border-success/30 bg-success-soft/30 p-5 dark:bg-success/10"
              spotlightColor="hsl(var(--success) / 0.2)"
            >
              <p className="text-xs font-semibold text-success-soft-foreground dark:text-success-soft-foreground">
                Purchases
              </p>
              <p className="mt-3 text-2xl font-bold tabular-nums text-foreground">
                <NumberTicker value={purchases} />
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Checkout and purchase events
              </p>
            </SpotlightCard>
            <SpotlightCard
              className="border-info/30 bg-info-soft/40 p-5 dark:bg-info/10"
              spotlightColor="hsl(var(--info) / 0.2)"
            >
              <p className="text-xs font-semibold text-info-soft-foreground dark:text-info-soft-foreground">
                Repeat buyers
              </p>
              <p className="mt-3 text-2xl font-bold tabular-nums text-foreground">
                <NumberTicker value={repeatBuyers} />
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Contacts with more than one conversion
              </p>
            </SpotlightCard>
          </BentoGrid>

          <Card className="rounded-3xl">
            <CardHeader className="border-b border-border pb-4">
              <CardTitle className="text-base font-semibold tracking-tight">
                Revenue by keyword &amp; creative
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Server-verified conversions only. Connect your checkout with the token in Settings.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-5">
              {topCreatives.length > 0 ? (
                <div className="space-y-3">
                  {topCreatives.map((creative) => (
                    <div
                      key={creative.label}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold">{creative.label}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {creative.count} conversions
                        </p>
                      </div>
                      <p className="shrink-0 text-sm font-bold tabular-nums">
                        {currency}{" "}
                        {(creative.revenue / 100).toLocaleString("en-IN", {
                          maximumFractionDigits: 0,
                        })}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-10 text-center">
                  <BarChart3 className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
                  <p className="mt-2 text-sm font-semibold text-foreground">
                    No tracked revenue yet
                  </p>
                  <p className="mx-auto mt-1 max-w-md text-[11px] text-muted-foreground">
                    Copy your conversion token from Settings and send a purchase event from your checkout. Revenue will appear against the keyword and post that started it.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Audience ── */}
      {activeTab === "audience" && (
        <div className="space-y-5">
          <Card className="rounded-3xl">
            <CardHeader className="border-b border-border pb-4">
              <CardTitle className="flex items-center gap-2 text-base font-semibold tracking-tight">
                <UserPlus className="size-4 text-info" aria-hidden="true" />
                Follower growth from in-chat prompts
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Only people who were not following before the prompt and were verified afterwards count as growth.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-5">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  { label: "New followers", value: followStats.newFollowers },
                  { label: "Prompts sent", value: followStats.sent },
                  {
                    label: "Tap rate",
                    value: followStats.tapRate === null ? "—" : `${followStats.tapRate}%`,
                  },
                  { label: "Content delivered", value: followStats.delivered },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-2xl border border-border bg-muted/40 p-3.5"
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {item.label}
                    </p>
                    <p className="mt-1.5 text-2xl font-bold tabular-nums text-foreground">
                      {item.value}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-3xl">
            <CardHeader className="border-b border-border pb-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base font-semibold tracking-tight">
                    Keyword ingestion leaderboard
                  </CardTitle>
                  <CardDescription className="mt-0.5 text-xs text-muted-foreground">
                    Distribution of comment keywords generating automated DM funnels
                  </CardDescription>
                </div>
                <Badge variant="outline" className="rounded-full px-3 text-[10px] font-semibold">
                  {sortedKeywords.length} active triggers
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-5">
              {sortedKeywords.length > 0 ? (
                <div className="space-y-4">
                  {sortedKeywords.map((kw) => (
                    <div key={kw.keyword} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="rounded-full bg-primary px-2.5 py-1 font-mono text-xs font-medium text-primary-foreground">
                          {kw.keyword}
                        </span>
                        <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
                          {kw.count} triggers ({kw.share})
                        </span>
                      </div>
                      <Progress value={parseInt(kw.share) || 0} className="h-2" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-10 text-center">
                  <Inbox className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
                  <p className="mt-2 text-sm font-semibold text-foreground">
                    No keyword data recorded yet
                  </p>
                  <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                    {activeKeywords.length > 0
                      ? `Active listening keywords: ${activeKeywords.join(", ")}. When followers comment these words, statistics appear here.`
                      : "Create your first comment-to-DM campaign to start tracking keyword performance."}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Campaigns ── */}
      {activeTab === "campaigns" && (
        <div className="space-y-5">
          <Card className="rounded-3xl">
            <CardHeader className="border-b border-border pb-4">
              <CardTitle className="text-base font-semibold tracking-tight">
                Campaign performance
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Automated DMs ÷ impressions for each campaign&apos;s post.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-5">
              {campaignInsights.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-xs">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                        <th scope="col" className="px-3 py-2 font-semibold">Campaign</th>
                        <th scope="col" className="px-3 py-2 text-right font-semibold">DMs</th>
                        <th scope="col" className="px-3 py-2 text-right font-semibold">Impressions</th>
                        <th scope="col" className="px-3 py-2 text-right font-semibold">Conversion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {campaignInsights.map((row) => (
                        <tr key={row.automationId} className="border-t border-border/60">
                          <td className="max-w-[240px] truncate px-3 py-2 font-medium text-foreground">
                            {row.name}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {row.dms.toLocaleString("en-IN")}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {row.impressions.toLocaleString("en-IN")}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">
                            {row.conversionRate === null
                              ? "—"
                              : `${row.conversionRate.toFixed(1)}%`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p role="status" className="py-4 text-center text-xs text-muted-foreground">
                  No campaign insights yet. Publish a campaign and connect an Instagram account with insights access.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-3xl">
            <CardHeader className="border-b border-border pb-4">
              <CardTitle className="text-base font-semibold tracking-tight">
                Top performer
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                The campaign delivering the most DMs in this period.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-5">
              {topAutomation ? (
                <div className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {topAutomation.name}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {topAutomation.count.toLocaleString("en-IN")} DMs delivered
                    </p>
                  </div>
                  <Button asChild variant="outline" size="sm" className="h-8 w-fit rounded-full text-[11px]">
                    <Link href={`/dashboard/campaigns/${topAutomation.id}/edit`}>
                      Edit campaign
                    </Link>
                  </Button>
                </div>
              ) : (
                <p role="status" className="py-4 text-center text-xs text-muted-foreground">
                  No campaign data yet.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Accounts ── */}
      {activeTab === "accounts" && (
        <div className="space-y-5">
          {accountBreakdown.length > 0 && (
            <Card className="rounded-3xl">
              <CardHeader className="border-b border-border pb-4">
                <CardTitle className="text-base font-semibold tracking-tight">
                  Per-account breakdown
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  DMs, delivery and conversions for each connected Instagram account.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-5">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] text-xs">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                        <th scope="col" className="py-2 font-semibold">Account</th>
                        <th scope="col" className="py-2 text-right font-semibold">DMs</th>
                        <th scope="col" className="py-2 text-right font-semibold">Delivery</th>
                        <th scope="col" className="py-2 text-right font-semibold">Conversions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {accountBreakdown.map((row) => (
                        <tr key={row.id} className="border-t border-border/60">
                          <td className="max-w-[200px] truncate py-2 text-foreground">
                            {row.username ? `@${row.username}` : row.id.slice(0, 8)}
                          </td>
                          <td className="py-2 text-right font-mono tabular-nums">
                            {row.dms.toLocaleString("en-IN")}
                          </td>
                          <td className="py-2 text-right font-mono tabular-nums">
                            {row.deliveryRate === null ? "—" : `${row.deliveryRate}%`}
                          </td>
                          <td className="py-2 text-right font-mono tabular-nums">
                            {row.conversions}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          <DmQueueCard
            pending={queueStats.pending}
            failed={queueStats.failed}
            oldestPendingAt={queueStats.oldestPendingAt}
            timeZone={timeZone}
          />

          <SafetyCard
            stats={safetyStats}
            accounts={accountHealth}
            score={safetyResult.score}
            band={safetyResult.label}
          />
        </div>
      )}
    </div>
  );
}
