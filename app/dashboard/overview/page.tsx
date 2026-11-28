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
    <div className="space-y-6 animate-pulse">
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
  searchParams?: Promise<{ range?: string }>;
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

  // â”€â”€ Phase A funnel signals â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      ? `${row.keyword}${row.post_id ? ` Â· ${row.post_id.slice(-6)}` : ""}`
      : `Post Â· ${String(row.post_id).slice(-6)}`;
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

  // â”€â”€ Meta insights snapshots (last 30 days) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  const snapshotCount = insightsSummary.hasData ? 1 : 0;
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

  return (
    <div className="space-y-6 animate-in fade-in duration-300 antialiased selection:bg-[#ffd02f] selection:text-[#1c1c1e]">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-[#e0e2e8] dark:border-border/80">
        <div>
          <h1 className="text-2xl sm:text-3xl font-medium tracking-tight text-foreground flex items-center gap-2 font-rubik">
            Analytics &amp; Performance
          </h1>
          <p className="text-[#555a6a] dark:text-muted-foreground text-xs sm:text-sm mt-0.5">
            Keyword triggers and delivery performance measured from your automations.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
        {/* Timeframe Filter Navigation */}
        <div className="flex items-center gap-1.5 p-1 rounded-full bg-[#f0f2f5] dark:bg-muted/60 border border-[#e0e2e8] dark:border-border/60 w-fit">
          <Link
            href="/dashboard/overview?range=7d"
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
              range === "7d"
                ? "bg-white dark:bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            7 Days
          </Link>
          <Link
            href="/dashboard/overview?range=30d"
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
              range === "30d"
                ? "bg-white dark:bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            30 Days
          </Link>
          <Link
            href="/dashboard/overview?range=all"
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
              range === "all"
                ? "bg-white dark:bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            All Time
          </Link>
        </div>
        {reportLink?.enabled ? (
          <Button
            asChild
            size="sm"
            variant="outline"
            className="rounded-full h-9 text-xs font-semibold gap-1.5"
          >
            <a
              href={`/report/${reportLink.token}`}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
              Share report
            </a>
          </Button>
        ) : (
          <Button
            asChild
            size="sm"
            variant="outline"
            className="rounded-full h-9 text-xs font-semibold gap-1.5"
          >
            <Link href="/dashboard/settings">
              <ExternalLink className="size-3.5" aria-hidden="true" />
              Create report link
            </Link>
          </Button>
        )}
        </div>
      </div>

      {/* â”€â”€ Wins & Fixes: the three things a busy creator needs today â”€â”€ */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="rounded-2xl border border-[#ffd02f]/40 bg-[#fff8e0]/40 dark:bg-[#746019]/10 shadow-subtle p-5 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#746019] dark:text-[#ffd02f]">
            <Trophy className="size-4" /> Top performer
          </div>
          <p className="text-lg font-semibold tracking-tight text-foreground">
            {topAutomation ? topAutomation.name : "No campaign data yet"}
          </p>
          <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground">
            {topAutomation
              ? `${topAutomation.count} DMs delivered in this period Â· Edit the winner`
              : "Publish a campaign and comment your keyword to see results here."}
          </p>
          {topAutomation && (
            <Button asChild variant="outline" size="sm" className="rounded-full text-[11px] h-8">
              <Link href={`/dashboard/campaigns/${topAutomation.id}/edit`}>Duplicate flow</Link>
            </Button>
          )}
        </Card>

        <Card className="rounded-2xl border border-[#ff9999]/40 bg-[#ffe6cd]/40 dark:bg-[#804000]/10 shadow-subtle p-5 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#8a3b18] dark:text-[#ff9999]">
            <TrendingDown className="size-4" /> Biggest leak
          </div>
          <p className="text-lg font-semibold tracking-tight text-foreground">
            {biggestLeak.label}
          </p>
          <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground">
            {worstDrop > 0
              ? `${Math.round(worstDrop * 100)}% drop at this step. ${biggestLeak.detail}`
              : biggestLeak.detail}
          </p>
          <Button asChild variant="outline" size="sm" className="rounded-full text-[11px] h-8">
            <Link href={biggestLeak.href}>Fix it</Link>
          </Button>
        </Card>

        <Card className="rounded-2xl border border-[#0fbcb0]/30 bg-[#c3faf5]/40 dark:bg-[#187574]/10 shadow-subtle p-5 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#187574] dark:text-[#c3faf5]">
            <Sparkles className="size-4" /> This week
          </div>
          <p className="text-lg font-semibold tracking-tight text-foreground">
            {revenueLabel ?? `${weeklySent} DMs Â· ${leadsCaptured} leads`}
          </p>
          <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground">
            {revenueLabel
              ? `${purchases} tracked purchases Â· ${repeatBuyers} repeat buyers`
              : `${confirmedOptins} opt-ins Â· ${linkClicks} tracked clicks â€” add your conversion token in Settings to see revenue`}
          </p>
          <Button asChild variant="outline" size="sm" className="rounded-full text-[11px] h-8">
            <Link href="/dashboard/campaigns">View campaigns</Link>
          </Button>
        </Card>
      </div>

      {/* â”€â”€ Conversion funnel v1 â”€â”€ */}
      <Card className="rounded-2xl glass-card border border-[#e0e2e8] dark:border-border shadow-subtle">
        <CardHeader className="pb-4 border-b border-[#e0e2e8] dark:border-border/60">
          <CardTitle className="text-base font-semibold tracking-tight">
            Conversion funnel
          </CardTitle>
          <CardDescription className="text-xs text-[#555a6a] dark:text-muted-foreground">
            Every step uses real stored events. Instagram does not expose DM opens, so delivery and clicks are the measurable steps.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {funnelSteps.map((step, index) => {
              const previous = index > 0 ? funnelSteps[index - 1].value : null;
              const rate =
                previous && previous > 0
                  ? Math.round((step.value / previous) * 100)
                  : null;
              return (
                <Link
                  key={step.label}
                  href={step.href}
                  className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 bg-[#f7f8fa] dark:bg-muted/30 p-3.5 hover:border-[#4262ff]/50 transition-colors"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6b6f7e]">
                    {step.label}
                  </p>
                  <p className="mt-1.5 text-2xl font-bold tracking-tight text-foreground">
                    {step.value}
                  </p>
                  <p className="mt-1 text-[10px] text-[#555a6a] dark:text-muted-foreground">
                    {rate === null
                      ? index === 0
                        ? "Entry step"
                        : "No prior data"
                      : `${rate}% of previous step`}
                  </p>
                </Link>
              );
            })}
          </div>
        </CardContent>
      </Card>

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

      {/* â”€â”€ Follower growth from in-chat prompts â”€â”€ */}
      <Card className="rounded-2xl glass-card border border-[#e0e2e8] dark:border-border shadow-subtle">
        <CardHeader className="pb-4 border-b border-[#e0e2e8] dark:border-border/60">
          <CardTitle className="text-base font-semibold tracking-tight flex items-center gap-2">
            <UserPlus className="size-4 text-[#4262ff]" aria-hidden="true" />
            Follower growth from in-chat prompts
          </CardTitle>
          <CardDescription className="text-xs text-[#555a6a] dark:text-muted-foreground">
            Only people who were not following before the prompt and were verified afterwards count as growth.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "New followers", value: followStats.newFollowers },
              { label: "Prompts sent", value: followStats.sent },
              {
                label: "Tap rate",
                value: followStats.tapRate === null ? "â€”" : `${followStats.tapRate}%`,
              },
              { label: "Content delivered", value: followStats.delivered },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 bg-[#f7f8fa] dark:bg-muted/30 p-3.5"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6b6f7e]">
                  {item.label}
                </p>
                <p className="mt-1.5 text-2xl font-bold tracking-tight text-foreground">
                  {item.value}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* â”€â”€ Revenue by creative â”€â”€ */}
      <Card className="rounded-2xl glass-card border border-[#e0e2e8] dark:border-border shadow-subtle">
        <CardHeader className="pb-4 border-b border-[#e0e2e8] dark:border-border/60">
          <CardTitle className="text-base font-semibold tracking-tight">
            Revenue by keyword &amp; creative
          </CardTitle>
          <CardDescription className="text-xs text-[#555a6a] dark:text-muted-foreground">
            Server-verified conversions only. Connect your checkout with the token in Settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5">
          {topCreatives.length > 0 ? (
            <div className="space-y-3">
              {topCreatives.map((creative) => (
                <div
                  key={creative.label}
                  className="flex items-center justify-between gap-3 rounded-xl border border-[#e0e2e8] dark:border-border/80 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate">{creative.label}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {creative.count} conversions
                    </p>
                  </div>
                  <p className="text-sm font-bold shrink-0">
                    {currency} {(creative.revenue / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-10 text-center space-y-2">
              <BarChart3 className="size-8 mx-auto text-muted-foreground" />
              <p className="text-sm font-semibold text-foreground">
                No tracked revenue yet
              </p>
              <p className="text-[11px] text-muted-foreground max-w-md mx-auto">
                Copy your conversion token from Settings and send a purchase event from your checkout. Revenue will appear against the keyword and post that started it.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* â”€â”€ Key Conversion Stats in Miro Pastel Tints + Liquid Glass â”€â”€ */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="rounded-2xl glass-card liquid-sheen border border-[#0fbcb0]/30 bg-[#c3faf5]/30 dark:bg-[#187574]/10 shadow-subtle p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#187574] dark:text-[#c3faf5]">Delivery Success Rate</span>
            <div className="size-8 rounded-full bg-[#0fbcb0] text-white flex items-center justify-center font-bold shadow-xs">
              <TrendingUp className="size-4" />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-3xl font-bold tracking-tight text-foreground">
              {deliveryRate === null ? "â€”" : `${deliveryRate}%`}
            </div>
            <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground mt-1 flex items-center gap-1 font-medium">
              <CheckCircle2 className="size-3.5 text-[#00b473] inline" aria-hidden="true" />
              <span>
                {totalDms > 0
                  ? `${deliveredDms} of ${totalDms} automated messages delivered`
                  : "No deliveries in this period"}
              </span>
            </p>
          </div>
        </Card>

        <Card className="rounded-2xl glass-card liquid-sheen border border-[#ffd02f]/30 bg-[#fff8e0]/40 dark:bg-[#746019]/10 shadow-subtle p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#746019] dark:text-[#ffd02f]">Total Messages Sent</span>
            <div className="size-8 rounded-full bg-[#ffd02f] text-[#1c1c1e] flex items-center justify-center font-bold shadow-xs">
              <Send className="size-4" />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-3xl font-bold tracking-tight text-foreground">{totalDms}</div>
            <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground mt-1">
              comment-triggered direct messages
            </p>
          </div>
        </Card>

        <Card className="rounded-2xl glass-card liquid-sheen border border-[#ffd8f4]/40 bg-[#fde0f0]/30 dark:bg-[#7d2663]/10 shadow-subtle p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#7d2663] dark:text-[#ffd8f4]">Processing Time</span>
            <div className="size-8 rounded-full bg-[#ffd8f4] text-[#7d2663] flex items-center justify-center font-bold shadow-xs">
              <Zap className="size-4" aria-hidden="true" />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-3xl font-bold tracking-tight text-foreground">
              {health.available && health.avgDurationMs !== null
                ? `${health.avgDurationMs} ms`
                : "â€”"}
            </div>
            <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground mt-1 font-medium">
              {health.available && health.total > 0
                ? `From webhook to DM Â· ${health.successRate ?? 0}% success over ${health.total} jobs`
                : "No deliveries measured in the last 7 days"}
            </p>
          </div>
        </Card>
      </div>

      {/* â”€â”€ Top Keywords Performance (Miro Leaderboard with Progress) â”€â”€ */}
      <Card className="rounded-2xl glass-card border border-[#e0e2e8] dark:border-border shadow-subtle">
        <CardHeader className="pb-4 border-b border-[#e0e2e8] dark:border-border/60">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold tracking-tight">Keyword Ingestion Leaderboard</CardTitle>
              <CardDescription className="text-xs mt-0.5 text-[#555a6a] dark:text-muted-foreground">
                Distribution of comment keywords generating automated direct message funnels
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-[10px] font-semibold rounded-full px-3">
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
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-1 rounded-full bg-[#1c1c1e] text-white font-mono font-medium text-xs dark:bg-white dark:text-[#1c1c1e]">
                        {kw.keyword}
                      </span>
                    </div>
                    <span className="font-mono text-xs text-foreground font-semibold">
                      {kw.count} triggers ({kw.share})
                    </span>
                  </div>
                  <Progress value={parseInt(kw.share) || 0} className="h-2" />
                </div>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center space-y-3">
              <div className="size-11 rounded-2xl bg-[#fff8e0] text-[#746019] flex items-center justify-center mx-auto shadow-xs">
                <Inbox className="size-5" />
              </div>
              <div>
                <p className="font-semibold text-base text-foreground">No keyword data recorded yet</p>
                <p className="text-xs text-[#555a6a] dark:text-muted-foreground max-w-sm mx-auto mt-1">
                  {activeKeywords.length > 0 ? (
                    <span>
                      Active listening keywords:{" "}
                      {activeKeywords.map((k) => (
                        <span key={k} className="mx-1 px-2 py-0.5 rounded-full bg-[#1c1c1e] text-white font-mono text-xs">
                          {k}
                        </span>
                      ))}
                      . When followers comment these words on your posts, conversion statistics will appear here.
                    </span>
                  ) : (
                    "Create your first comment-to-DM campaign to start tracking keyword performance."
                  )}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* â”€â”€ Instagram Insights (daily snapshots) â”€â”€ */}
      <Card className="rounded-2xl glass-card border border-[#e0e2e8] dark:border-border shadow-subtle">
        <CardHeader className="pb-4 border-b border-[#e0e2e8] dark:border-border/60">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-semibold tracking-tight">
                Instagram Insights
              </CardTitle>
              <CardDescription className="text-xs mt-0.5 text-[#555a6a] dark:text-muted-foreground">
                Reach, impressions, profile views and story views from Meta, with per-campaign conversion.
              </CardDescription>
            </div>
            <form action={refreshInsightsAction}>
              <Button
                type="submit"
                size="sm"
                variant="outline"
                className="rounded-full h-9 px-4 text-xs font-semibold gap-1.5"
              >
                <RefreshCw className="size-3.5" />
                Refresh insights
              </Button>
            </form>
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          {insightsStatus === "needs_access" ? (
            <div role="alert" className="rounded-2xl border border-amber-400/50 bg-amber-50/70 dark:bg-amber-950/20 p-5 space-y-3">
              <div className="flex items-start gap-3">
                <div className="size-10 rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 flex items-center justify-center shrink-0">
                  <BarChart3 className="size-5" aria-hidden="true" />
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-sm text-foreground">
                    Insights access needed
                  </p>
                  <p className="text-xs text-[#555a6a] dark:text-muted-foreground max-w-lg">
                    {insightsError ??
                      "Meta did not grant instagram_manage_insights. Reconnect your Instagram account and approve Insights access to see reach, impressions and conversion rates."}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm" className="rounded-full h-8 text-xs font-semibold">
                  <Link href="/dashboard/settings">Reconnect Instagram</Link>
                </Button>
                <Button asChild size="sm" variant="outline" className="rounded-full h-8 text-xs font-semibold">
                  <Link href="/dashboard/diagnostics">Run diagnostics</Link>
                </Button>
              </div>
            </div>
          ) : snapshotCount === 0 ? (
            <div role="status" className="py-10 text-center space-y-3">
              <div className="size-11 rounded-2xl bg-[#fff8e0] text-[#746019] dark:bg-[#746019]/30 dark:text-[#ffd02f] flex items-center justify-center mx-auto shadow-xs">
                <BarChart3 className="size-5" aria-hidden="true" />
              </div>
              <div>
                <p className="font-semibold text-base text-foreground">
                  Insights will appear after the daily refresh
                </p>
                <p className="text-xs text-[#555a6a] dark:text-muted-foreground max-w-sm mx-auto mt-1">
                  Connect an Instagram account with insights access. Snapshots are recorded once a day and shown here automatically.
                </p>
              </div>
            </div>
          ) : (
            <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-2xl border border-[#4262ff]/25 bg-[#f5f3ff]/60 dark:bg-[#4262ff]/10 p-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-[#4262ff] dark:text-[#8b9eff]">Reach</span>
                  <Users className="size-3.5 text-[#4262ff]" aria-hidden="true" />
                </div>
                <p className="text-2xl font-bold text-foreground">
                  {insightTotals.reach.toLocaleString()}
                </p>
                <p className="text-[10px] text-[#6b6f7e]">Unique accounts reached</p>
              </div>

              <div className="rounded-2xl border border-[#0fbcb0]/30 bg-[#c3faf5]/30 dark:bg-[#187574]/10 p-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-[#187574] dark:text-[#c3faf5]">Impressions</span>
                  <Eye className="size-3.5 text-[#0fbcb0]" aria-hidden="true" />
                </div>
                <p className="text-2xl font-bold text-foreground">
                  {insightTotals.impressions.toLocaleString()}
                </p>
                <p className="text-[10px] text-[#6b6f7e]">Total views in the period</p>
              </div>

              <div className="rounded-2xl border border-[#ffd8f4]/50 bg-[#fde0f0]/30 dark:bg-[#7d2663]/10 p-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-[#7d2663] dark:text-[#ffd8f4]">Profile views</span>
                  <BarChart3 className="size-3.5 text-[#7d2663]" aria-hidden="true" />
                </div>
                <p className="text-2xl font-bold text-foreground">
                  {insightTotals.profileViews.toLocaleString()}
                </p>
                <p className="text-[10px] text-[#6b6f7e]">Visits to your profile</p>
              </div>

              <div className="rounded-2xl border border-[#8b5cf6]/30 bg-[#f5f3ff]/40 dark:bg-[#8b5cf6]/10 p-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-[#6d28d9] dark:text-[#c4b5fd]">Story views</span>
                  <Eye className="size-3.5 text-[#8b5cf6]" aria-hidden="true" />
                </div>
                <p className="text-2xl font-bold text-foreground">
                  {insightTotals.storyViews.toLocaleString()}
                </p>
                <p className="text-[10px] text-[#6b6f7e]">Views on your stories</p>
              </div>

              <div className="rounded-2xl border border-[#ffd02f]/40 bg-[#fff8e0]/50 dark:bg-[#746019]/10 p-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-[#746019] dark:text-[#ffd02f]">Conversion rate</span>
                  <TrendingUp className="size-3.5 text-[#746019] dark:text-[#ffd02f]" aria-hidden="true" />
                </div>
                <p className="text-2xl font-bold text-foreground">
                  {conversionRate === null ? "—" : `${conversionRate}%`}
                </p>
                <p className="text-[10px] text-[#6b6f7e]">
                  {insightTotals.impressions > 0
                    ? `${totalDms} DMs Ã· ${insightTotals.impressions.toLocaleString()} impressions`
                    : "No impressions recorded yet"}
                </p>
              </div>
            </div>

            {insightsSummary.daily.length > 0 && (
              <div className="mt-4 rounded-2xl border border-[#e0e2e8] dark:border-border p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-foreground">Reach trend (last 30 days)</p>
                  {insightsLastSyncedAt && (
                    <p className="text-[10px] text-[#6b6f7e]">
                      Synced{" "}
                      {new Date(insightsLastSyncedAt).toLocaleString("en-IN", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone,
                      })}
                    </p>
                  )}
                </div>
                <div
                  className="flex items-end gap-1 h-20"
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
                        className="flex-1 rounded-t bg-[#4262ff]/70 dark:bg-[#8b9eff]/70 min-w-[3px]"
                        style={{ height: `${height}%` }}
                        title={`${point.day}: ${point.reach.toLocaleString()} reach`}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {campaignInsights.length > 0 && (
              <div className="mt-4 rounded-2xl border border-[#e0e2e8] dark:border-border overflow-hidden">
                <div className="px-4 py-3 border-b border-[#e0e2e8] dark:border-border/60">
                  <p className="text-xs font-semibold text-foreground">Conversion by campaign</p>
                  <p className="text-[10px] text-[#6b6f7e] mt-0.5">
                    Automated DMs Ã· impressions for each campaign&apos;s post.
                  </p>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-[#6b6f7e]">
                      <th scope="col" className="px-4 py-2 font-semibold">Campaign</th>
                      <th scope="col" className="px-4 py-2 font-semibold text-right">DMs</th>
                      <th scope="col" className="px-4 py-2 font-semibold text-right">Impressions</th>
                      <th scope="col" className="px-4 py-2 font-semibold text-right">Conversion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaignInsights.map((row) => (
                      <tr key={row.automationId} className="border-t border-[#e0e2e8]/60 dark:border-border/40">
                        <td className="px-4 py-2 font-medium text-foreground truncate max-w-[220px]">
                          {row.name}
                        </td>
                        <td className="px-4 py-2 text-right font-mono">{row.dms.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right font-mono">
                          {row.impressions.toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-right font-mono font-semibold">
                          {row.conversionRate === null
                            ? "â€”"
                            : `${row.conversionRate.toFixed(1)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            </>
          )}
        </CardContent>
      </Card>

      {accountBreakdown.length > 0 && (
        <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border shadow-subtle">
          <CardHeader className="pb-3 border-b border-[#e0e2e8] dark:border-border/60">
            <CardTitle className="text-base font-semibold tracking-tight">
              Per-account breakdown
            </CardTitle>
            <CardDescription className="text-xs mt-0.5 text-[#555a6a] dark:text-muted-foreground">
              DMs, delivery and conversions for each connected Instagram account.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-5">
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[420px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-[#6b6f7e]">
                    <th scope="col" className="py-2 font-semibold">Account</th>
                    <th scope="col" className="py-2 font-semibold text-right">DMs</th>
                    <th scope="col" className="py-2 font-semibold text-right">Delivery</th>
                    <th scope="col" className="py-2 font-semibold text-right">Conversions</th>
                  </tr>
                </thead>
                <tbody>
                  {accountBreakdown.map((row) => (
                    <tr key={row.id} className="border-t border-[#e0e2e8]/60 dark:border-border/40">
                      <td className="py-2 text-foreground truncate max-w-[200px]">
                        {row.username ? `@${row.username}` : row.id.slice(0, 8)}
                      </td>
                      <td className="py-2 text-right font-mono">{row.dms.toLocaleString()}</td>
                      <td className="py-2 text-right font-mono">
                        {row.deliveryRate === null ? "—" : `${row.deliveryRate}%`}
                      </td>
                      <td className="py-2 text-right font-mono">{row.conversions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border shadow-subtle">
        <CardHeader className="pb-3 border-b border-[#e0e2e8] dark:border-border/60">
          <CardTitle className="text-base font-semibold tracking-tight">Conversion funnel</CardTitle>
          <CardDescription className="text-xs mt-0.5 text-[#555a6a] dark:text-muted-foreground">
            Daily rollups plus today&apos;s live counters from Redis â€” last {analyticsDays} days.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5">
          {!analytics || analytics.summary.dmSent === 0 ? (
            <p role="status" className="text-xs text-muted-foreground py-4 text-center">
              No conversion events yet. They appear here as soon as a DM is sent or a tracked link is clicked.
            </p>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: "DMs sent", value: analytics.summary.dmSent.toLocaleString(), hint: "Automated deliveries" },
                { label: "Link clicks", value: analytics.summary.dmLinkClicks.toLocaleString(), hint: `${analytics.summary.dmCtrPct}% click-through` },
                { label: "Follower replies", value: analytics.summary.dmReplies.toLocaleString(), hint: `${analytics.summary.dmReplyRatePct}% reply rate` },
                { label: "Bio clicks", value: analytics.summary.bioClicks.toLocaleString(), hint: "Link-in-bio clicks" },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-[#e0e2e8] dark:border-border p-4 space-y-1">
                  <p className="text-[11px] font-semibold text-muted-foreground">{item.label}</p>
                  <p className="text-2xl font-bold text-foreground">{item.value}</p>
                  <p className="text-[10px] text-[#6b6f7e]">{item.hint}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
