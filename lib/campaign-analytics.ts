/**
 * Per-campaign analytics aggregation.
 *
 * One place that turns raw ledger rows into the small set of numbers a creator
 * actually needs to judge whether a campaign is working. Every metric here is
 * derived from stored data — no fabricated or vanity figures.
 */

import { getAdminDb, hasAdminDb } from "@/lib/db-admin";

export interface CampaignAnalytics {
  dmSent: number;
  dmFailed: number;
  deliveryRate: number | null;
  linkClicks: number;
  uniqueClickers: number;
  conversions: number;
  revenueMinor: number;
  publicRepliesSent: number;
  publicRepliesFailed: number;
  openingMessagesSent: number;
  followChecks: number;
  followersConfirmed: number;
  variants: Array<{ label: string; sent: number }>;
  formats: Array<{ format: string; sent: number }>;
  vouchersGenerated: number;
  voucherConversions: number;
}

const EMPTY: CampaignAnalytics = {
  dmSent: 0,
  dmFailed: 0,
  deliveryRate: null,
  linkClicks: 0,
  uniqueClickers: 0,
  conversions: 0,
  revenueMinor: 0,
  publicRepliesSent: 0,
  publicRepliesFailed: 0,
  openingMessagesSent: 0,
  followChecks: 0,
  followersConfirmed: 0,
  variants: [],
  formats: [],
  vouchersGenerated: 0,
  voucherConversions: 0,
};

export async function loadCampaignAnalytics(
  workspaceId: string,
  automationId: string
): Promise<CampaignAnalytics> {
  if (!hasAdminDb()) return { ...EMPTY };

  const db = getAdminDb();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    dmLogsRes,
    publicRepliesRes,
    linkClicksRes,
    conversionsRes,
    vouchersRes,
    followChecksRes,
  ] = await Promise.all([
    db
      .from("dm_logs")
      .select("status, variant, message_format, recipient_id, trigger_keyword, keyword")
      .eq("workspace_id", workspaceId)
      .eq("automation_id", automationId)
      .gte("sent_at", since)
      .limit(5000),
    db
      .from("public_replies")
      .select("status")
      .eq("automation_id", automationId)
      .gte("created_at", since)
      .limit(5000),
    db
      .from("link_clicks")
      .select("contact_id, is_bot")
      .eq("automation_id", automationId)
      .gte("clicked_at", since)
      .limit(5000),
    db
      .from("conversions")
      .select("revenue_minor, contact_id")
      .eq("workspace_id", workspaceId)
      .eq("automation_id", automationId)
      .gte("occurred_at", since)
      .limit(5000),
    db
      .from("dm_vouchers")
      .select("id, recipient_id")
      .eq("scope_key", `auto:${automationId}`)
      .limit(5000),
    db
      .from("follow_checks")
      .select("status")
      .eq("automation_id", automationId)
      .limit(5000),
  ]);

  const dmLogs = dmLogsRes.data ?? [];
  const dmSent = dmLogs.filter((r) => r.status === "SENT").length;
  const dmFailed = dmLogs.filter((r) => r.status === "FAILED").length;
  const deliveryRate =
    dmSent + dmFailed > 0 ? Math.round((dmSent / (dmSent + dmFailed)) * 100) : null;

  // Variant performance
  const variantMap = new Map<string, number>();
  for (const row of dmLogs) {
    if (row.status !== "SENT") continue;
    const variant = String(row.variant ?? "default");
    variantMap.set(variant, (variantMap.get(variant) ?? 0) + 1);
  }
  const variants = [...variantMap.entries()]
    .map(([label, sent]) => ({ label, sent }))
    .sort((a, b) => b.sent - a.sent);

  // Format breakdown
  const formatMap = new Map<string, number>();
  for (const row of dmLogs) {
    if (row.status !== "SENT") continue;
    const format = String(row.message_format ?? "text");
    formatMap.set(format, (formatMap.get(format) ?? 0) + 1);
  }
  const formats = [...formatMap.entries()]
    .map(([format, sent]) => ({ format, sent }))
    .sort((a, b) => b.sent - a.sent);

  // Public replies
  const publicReplies = publicRepliesRes.data ?? [];
  const publicRepliesSent = publicReplies.filter((r) => r.status === "sent").length;
  const publicRepliesFailed = publicReplies.filter((r) => r.status === "failed").length;

  // Link clicks
  const clicks = (linkClicksRes.data ?? []).filter((r) => !r.is_bot);
  const uniqueClickers = new Set(clicks.map((r) => r.contact_id).filter(Boolean)).size;

  // Conversions
  const conversions = conversionsRes.data ?? [];
  const revenueMinor = conversions.reduce(
    (sum, row) => sum + Number(row.revenue_minor ?? 0),
    0
  );

  // Vouchers
  const vouchers = vouchersRes.data ?? [];
  const voucherCodes = new Set(vouchers.map((v) => v.recipient_id));
  const voucherConversions = conversions.filter((c) =>
    c.contact_id && voucherCodes.has(c.contact_id)
  ).length;

  // Follow gate
  const checks = followChecksRes.data ?? [];
  const followersConfirmed = checks.filter((c) => c.status === "follower").length;

  // Opening messages
  const openingMessagesSent = dmLogs.filter(
    (r) => r.trigger_keyword === "OPENING" || r.keyword === "OPENING"
  ).length;

  return {
    dmSent,
    dmFailed,
    deliveryRate,
    linkClicks: clicks.length,
    uniqueClickers,
    conversions: conversions.length,
    revenueMinor,
    publicRepliesSent,
    publicRepliesFailed,
    openingMessagesSent,
    followChecks: checks.length,
    followersConfirmed,
    variants,
    formats,
    vouchersGenerated: vouchers.length,
    voucherConversions,
  };
}
