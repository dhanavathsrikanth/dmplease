/**
 * Public, read-only performance report.
 *
 * Loaded only after a valid, enabled, non-revoked token is presented. Every
 * figure is derived from stored rows — no Redis, no fabricated numbers.
 */

import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { getWorkspacePreferences } from "@/lib/workspace-preferences";
import { DEFAULT_TIMEZONE, getDayKey } from "@/lib/timezone";

export interface PublicReportTotals {
  dmsSent: number;
  dmsFailed: number;
  deliveryRate: number | null;
  optIns: number;
  linkClicks: number;
  conversions: number;
  revenueMinor: number;
  currency: string;
  comments: number;
  leads: number;
}

export interface PublicReportKeyword {
  keyword: string;
  count: number;
  share: number;
}

export interface PublicReportTrendPoint {
  day: string;
  dms: number;
  clicks: number;
}

export interface PublicReportCampaign {
  id: string;
  name: string;
  dms: number;
  clicks: number;
  conversions: number;
  revenueMinor: number;
}

export interface PublicReportAccount {
  id: string;
  username: string | null;
  dms: number;
  deliveryRate: number | null;
  conversions: number;
}

export interface PublicReport {
  workspaceName: string;
  generatedAt: string;
  days: number;
  timeZone: string;
  totals: PublicReportTotals;
  keywords: PublicReportKeyword[];
  trend: PublicReportTrendPoint[];
  campaigns: PublicReportCampaign[];
  accounts: PublicReportAccount[];
}

export interface PublicReportDmRow {
  automation_id: string | null;
  instagram_account_id: string | null;
  status: string | null;
  trigger_keyword: string | null;
  keyword: string | null;
  sequence_step: number | null;
  sent_at: string | null;
}

export interface PublicReportClickRow {
  automation_id: string | null;
  clicked_at: string | null;
}

export interface PublicReportConversionRow {
  automation_id: string | null;
  revenue_minor: number | null;
  currency: string | null;
  occurred_at: string | null;
}

export interface PublicReportInput {
  workspaceName: string;
  days: number;
  dms: PublicReportDmRow[];
  clicks: PublicReportClickRow[];
  conversions: PublicReportConversionRow[];
  comments: number;
  leads: number;
  automations: Array<{ id: string; name: string }>;
  accounts: Array<{ id: string; username: string | null }>;
  timeZone?: string;
}

function dayOf(value: string | null, timeZone: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return getDayKey(date, timeZone);
}

/** Pure aggregation so the report maths is testable without a database. */
export function summarizePublicReport(input: PublicReportInput): PublicReport {
  const { dms, clicks, conversions } = input;
  const timeZone = input.timeZone || DEFAULT_TIMEZONE;

  const dmsSent = dms.filter((row) => row.status === "SENT").length;
  const dmsFailed = dms.filter((row) => row.status === "FAILED").length;
  const deliveryRate =
    dmsSent + dmsFailed > 0
      ? Math.round((dmsSent / (dmsSent + dmsFailed)) * 100)
      : null;
  const optIns = dms.filter((row) => Number(row.sequence_step ?? 1) > 1).length;
  const revenueMinor = conversions.reduce(
    (sum, row) => sum + Number(row.revenue_minor ?? 0),
    0
  );
  const currency = conversions.find((row) => row.currency)?.currency ?? "INR";

  const keywordCounts = new Map<string, number>();
  for (const row of dms) {
    if (row.status !== "SENT") continue;
    const keyword = (row.trigger_keyword || row.keyword || "OTHER").toUpperCase();
    keywordCounts.set(keyword, (keywordCounts.get(keyword) ?? 0) + 1);
  }
  const keywords = [...keywordCounts.entries()]
    .map(([keyword, count]) => ({
      keyword,
      count,
      share: dmsSent > 0 ? Math.round((count / dmsSent) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const trendMap = new Map<string, PublicReportTrendPoint>();
  const ensureDay = (day: string) => {
    const point = trendMap.get(day) ?? { day, dms: 0, clicks: 0 };
    trendMap.set(day, point);
    return point;
  };
  for (const row of dms) {
    if (row.status !== "SENT") continue;
    const day = dayOf(row.sent_at, timeZone);
    if (day) ensureDay(day).dms++;
  }
  for (const row of clicks) {
    const day = dayOf(row.clicked_at, timeZone);
    if (day) ensureDay(day).clicks++;
  }
  const trend = [...trendMap.values()].sort((a, b) => a.day.localeCompare(b.day));

  const automationNames = new Map(
    input.automations.map((row) => [row.id, row.name])
  );
  const campaignMap = new Map<string, PublicReportCampaign>();
  const ensureCampaign = (id: string) => {
    const existing =
      campaignMap.get(id) ??
      ({
        id,
        name: automationNames.get(id) ?? "Campaign",
        dms: 0,
        clicks: 0,
        conversions: 0,
        revenueMinor: 0,
      } satisfies PublicReportCampaign);
    campaignMap.set(id, existing);
    return existing;
  };
  for (const row of dms) {
    if (row.status !== "SENT" || !row.automation_id) continue;
    ensureCampaign(row.automation_id).dms++;
  }
  for (const row of clicks) {
    if (!row.automation_id) continue;
    ensureCampaign(row.automation_id).clicks++;
  }
  for (const row of conversions) {
    if (!row.automation_id) continue;
    const campaign = ensureCampaign(row.automation_id);
    campaign.conversions++;
    campaign.revenueMinor += Number(row.revenue_minor ?? 0);
  }
  const campaigns = [...campaignMap.values()]
    .sort((a, b) => b.dms - a.dms || b.conversions - a.conversions)
    .slice(0, 10);

  const accountNames = new Map(
    input.accounts.map((row) => [row.id, row.username])
  );
  const accountMap = new Map<
    string,
    { dms: number; failed: number; conversions: number }
  >();
  const automationAccount = new Map<string, string>();
  for (const row of dms) {
    if (!row.instagram_account_id) continue;
    const id = row.instagram_account_id;
    const entry = accountMap.get(id) ?? { dms: 0, failed: 0, conversions: 0 };
    if (row.status === "SENT") entry.dms++;
    if (row.status === "FAILED") entry.failed++;
    accountMap.set(id, entry);
    if (row.automation_id && !automationAccount.has(row.automation_id)) {
      automationAccount.set(row.automation_id, id);
    }
  }
  for (const row of conversions) {
    if (!row.automation_id) continue;
    const accountId = automationAccount.get(row.automation_id);
    if (!accountId) continue;
    const entry = accountMap.get(accountId);
    if (entry) entry.conversions++;
  }
  const accounts: PublicReportAccount[] = [...accountMap.entries()]
    .map(([id, value]) => ({
      id,
      username: accountNames.get(id) ?? null,
      dms: value.dms,
      deliveryRate:
        value.dms + value.failed > 0
          ? Math.round((value.dms / (value.dms + value.failed)) * 100)
          : null,
      conversions: value.conversions,
    }))
    .sort((a, b) => b.dms - a.dms);

  return {
    workspaceName: input.workspaceName,
    generatedAt: new Date().toISOString(),
    days: input.days,
    timeZone,
    totals: {
      dmsSent,
      dmsFailed,
      deliveryRate,
      optIns,
      linkClicks: clicks.length,
      conversions: conversions.length,
      revenueMinor,
      currency,
      comments: input.comments,
      leads: input.leads,
    },
    keywords,
    trend,
    campaigns,
    accounts,
  };
}

export async function loadPublicReport(
  token: string,
  days = 30
): Promise<PublicReport | null> {
  if (!hasAdminDb()) return null;
  const db = getAdminDb();
  const windowDays = Math.min(365, Math.max(1, Math.floor(days)));

  const { data: link } = await db
    .from("report_links")
    .select("workspace_id, enabled, revoked_at")
    .eq("token", token)
    .maybeSingle();
  if (!link || !link.enabled || link.revoked_at) return null;

  const workspaceId = String(link.workspace_id);
  const since = new Date(
    Date.now() - windowDays * 24 * 60 * 60 * 1000
  ).toISOString();

  const [
    workspaceRes,
    dmRes,
    clickRes,
    conversionRes,
    commentRes,
    leadRes,
    automationRes,
    accountRes,
  ] = await Promise.all([
    db.from("workspaces").select("name").eq("id", workspaceId).maybeSingle(),
    db
      .from("dm_logs")
      .select(
        "automation_id, instagram_account_id, status, trigger_keyword, keyword, sequence_step, sent_at"
      )
      .eq("workspace_id", workspaceId)
      .gte("sent_at", since)
      .limit(10000),
    db
      .from("link_clicks")
      .select("automation_id, clicked_at")
      .eq("workspace_id", workspaceId)
      .eq("is_bot", false)
      .gte("clicked_at", since)
      .limit(10000),
    db
      .from("conversions")
      .select("automation_id, revenue_minor, currency, occurred_at")
      .eq("workspace_id", workspaceId)
      .gte("occurred_at", since)
      .limit(5000),
    db
      .from("comment_events")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .gte("received_at", since),
    db
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .gte("created_at", since),
    db.from("automations").select("id, name").eq("workspace_id", workspaceId),
    db
      .from("instagram_accounts")
      .select("id, username")
      .eq("workspace_id", workspaceId),
  ]);

  const preferences = await getWorkspacePreferences(workspaceId);

  return summarizePublicReport({
    workspaceName: String(workspaceRes.data?.name ?? "Workspace"),
    days: windowDays,
    timeZone: preferences.timezone,
    dms: (dmRes.data ?? []) as PublicReportDmRow[],
    clicks: (clickRes.data ?? []) as PublicReportClickRow[],
    conversions: (conversionRes.data ?? []) as PublicReportConversionRow[],
    comments: commentRes.count ?? 0,
    leads: leadRes.count ?? 0,
    automations: (automationRes.data ?? []).map((row) => ({
      id: String(row.id),
      name: String(row.name),
    })),
    accounts: (accountRes.data ?? []).map((row) => ({
      id: String(row.id),
      username: row.username ? String(row.username) : null,
    })),
  });
}
