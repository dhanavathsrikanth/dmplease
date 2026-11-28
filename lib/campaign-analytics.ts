/**
 * Per-campaign analytics aggregation.
 *
 * One place that turns raw ledger rows into the small set of numbers a creator
 * actually needs to judge whether a campaign is working. Every metric here is
 * derived from stored data — no fabricated or vanity figures.
 */

import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import {
  summarizeShares,
  type ShareClickRow,
  type ShareDmRow,
  type ShareEventRow,
  type ShareSummary,
} from "@/lib/share-analytics";
import {
  summarizeComments,
  type CommentClickRow,
  type CommentConversionRow,
  type CommentDmRow,
  type CommentEventRow,
  type CommentSummary,
} from "@/lib/comment-analytics";
import {
  buildCampaignComparison,
  type CampaignComparison,
  type ComparisonInput,
} from "@/lib/period-comparison";
import {
  DEFAULT_TIMEZONE,
  addDaysToDateOnly,
  getTodayInTimeZone,
  zonedTimeToUtc,
} from "@/lib/timezone";

export interface LeadBreakdown {
  field: string;
  label: string;
  total: number;
  values: Array<{ value: string; count: number }>;
}

export interface CampaignAnalytics {
  dmSent: number;
  dmFailed: number;
  deliveryRate: number | null;
  dmDelivered: number;
  dmRead: number;
  readRate: number | null;
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
  collectPrompts: number;
  leadsCaptured: number;
  leadsSkipped: number;
  leadCaptureRate: number | null;
  leadBreakdowns: LeadBreakdown[];
  shareTriggers: number;
  share: ShareSummary;
  comment: CommentSummary;
  comparison: CampaignComparison;
}

const EMPTY_INPUT: ComparisonInput = {
  dmSent: 0,
  dmFailed: 0,
  deliveryRate: null,
  readRate: null,
  linkClicks: 0,
  uniqueClickers: 0,
  conversions: 0,
  revenueMinor: 0,
  leadsCaptured: 0,
  leadCaptureRate: null,
  comment: {
    commentsReceived: 0,
    matchedComments: 0,
    dmsSent: 0,
    clicks: 0,
    conversions: 0,
    revenueMinor: 0,
    commentToDmRate: null,
    averageOrderValueMinor: null,
    revenuePerDmMinor: null,
    clickToConversionRate: null,
  },
  share: {
    sharesReceived: 0,
    dmsSent: 0,
    clicks: 0,
    shareToDmRate: null,
  },
};

const EMPTY_COMPARISON = buildCampaignComparison(EMPTY_INPUT, EMPTY_INPUT);

const LEAD_FIELD_LABELS: Record<string, string> = {
  email: "Email",
  phone: "Phone",
  name: "Name",
  gender: "Gender",
  age_group: "Age group",
};

function summarizeLeadBreakdowns(
  events: Array<{ kind: string; field: string | null; value: string | null }>
): LeadBreakdown[] {
  const map = new Map<string, Map<string, number>>();
  for (const event of events) {
    if (event.kind !== "captured" || !event.field) continue;
    const field = event.field;
    const value = (event.value ?? "").trim() || "Unknown";
    const values = map.get(field) ?? new Map<string, number>();
    values.set(value, (values.get(value) ?? 0) + 1);
    map.set(field, values);
  }
  return [...map.entries()]
    .map(([field, values]) => ({
      field,
      label: LEAD_FIELD_LABELS[field] ?? field,
      total: [...values.values()].reduce((sum, count) => sum + count, 0),
      values: [...values.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.total - a.total);
}

const EMPTY: CampaignAnalytics = {
  dmSent: 0,
  dmFailed: 0,
  deliveryRate: null,
  dmDelivered: 0,
  dmRead: 0,
  readRate: null,
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
  collectPrompts: 0,
  leadsCaptured: 0,
  leadsSkipped: 0,
  leadCaptureRate: null,
  leadBreakdowns: [],
  shareTriggers: 0,
  share: {
    sharesReceived: 0,
    uniqueSharers: 0,
    dmsSent: 0,
    dmsFailed: 0,
    skipped: 0,
    shareToDmRate: null,
    clicks: 0,
    topMedia: [],
  },
  comment: {
    commentsReceived: 0,
    uniqueCommenters: 0,
    matchedComments: 0,
    dmsSent: 0,
    dmsFailed: 0,
    skipped: 0,
    commentToDmRate: null,
    clicks: 0,
    conversions: 0,
    revenueMinor: 0,
    averageOrderValueMinor: null,
    revenuePerDmMinor: null,
    clickToConversionRate: null,
    avgResponseMs: null,
    daily: [],
    keywords: [],
    posts: [],
    mediaTypes: [],
    times: [],
  },
  comparison: EMPTY_COMPARISON,
};

/**
 * Loads the same metrics for the window immediately before the current one.
 * Kept separate from the main loader so the current-period code path is
 * untouched and the comparison can never change the headline numbers.
 */
async function loadPreviousPeriodInput(
  db: ReturnType<typeof getAdminDb>,
  workspaceId: string,
  automationId: string,
  since: string,
  until: string,
  timeZone: string
): Promise<ComparisonInput> {
  const [
    dmLogsRes,
    linkClicksRes,
    conversionsRes,
    leadEventsRes,
    automationRes,
    shareEventsRes,
    commentEventsRes,
  ] = await Promise.all([
    db
      .from("dm_logs")
      .select(
        "status, recipient_id, trigger_keyword, keyword, delivered_at, read_at, post_id, sent_at, variant"
      )
      .eq("workspace_id", workspaceId)
      .eq("automation_id", automationId)
      .gte("sent_at", since)
      .lt("sent_at", until)
      .limit(5000),
    db
      .from("link_clicks")
      .select("contact_id, is_bot, post_id, keyword")
      .eq("automation_id", automationId)
      .gte("clicked_at", since)
      .lt("clicked_at", until)
      .limit(5000),
    db
      .from("conversions")
      .select("revenue_minor, contact_id, keyword, post_id")
      .eq("workspace_id", workspaceId)
      .eq("automation_id", automationId)
      .gte("occurred_at", since)
      .lt("occurred_at", until)
      .limit(5000),
    db
      .from("lead_events")
      .select("kind, field, value")
      .eq("automation_id", automationId)
      .gte("created_at", since)
      .lt("created_at", until)
      .limit(5000),
    db
      .from("automations")
      .select("post_scope, post_id, trigger_keywords")
      .eq("id", automationId)
      .maybeSingle(),
    db
      .from("share_events")
      .select("sender_id, media_id, title, received_at")
      .eq("workspace_id", workspaceId)
      .gte("received_at", since)
      .lt("received_at", until)
      .limit(5000),
    db
      .from("comment_events")
      .select(
        "media_id, media_type, media_product_type, commenter_id, text, received_at"
      )
      .eq("workspace_id", workspaceId)
      .gte("received_at", since)
      .lt("received_at", until)
      .limit(5000),
  ]);

  const dmLogs = dmLogsRes.data ?? [];
  const dmSent = dmLogs.filter((r) => r.status === "SENT").length;
  const dmFailed = dmLogs.filter((r) => r.status === "FAILED").length;
  const deliveryRate =
    dmSent + dmFailed > 0 ? Math.round((dmSent / (dmSent + dmFailed)) * 100) : null;
  const dmRead = dmLogs.filter((r) => Boolean(r.read_at)).length;
  const readRate = dmSent > 0 ? Math.round((dmRead / dmSent) * 100) : null;

  const clicks = (linkClicksRes.data ?? []).filter((r) => !r.is_bot);
  const uniqueClickers = new Set(
    clicks.map((r) => r.contact_id).filter(Boolean)
  ).size;

  const conversions = conversionsRes.data ?? [];
  const revenueMinor = conversions.reduce(
    (sum, row) => sum + Number(row.revenue_minor ?? 0),
    0
  );

  const leadEvents = leadEventsRes.data ?? [];
  const collectPrompts = leadEvents.filter((e) => e.kind === "prompt").length;
  const leadsCaptured = leadEvents.filter((e) => e.kind === "captured").length;
  const leadCaptureRate =
    collectPrompts > 0 ? Math.round((leadsCaptured / collectPrompts) * 100) : null;

  const automationMeta = automationRes.data as
    | { post_scope?: string | null; post_id?: string | null; trigger_keywords?: string[] | null }
    | null;
  const shareEvents = (shareEventsRes.data ?? []) as ShareEventRow[];
  const scopedShareEvents =
    automationMeta?.post_scope === "SPECIFIC_POST" && automationMeta.post_id
      ? shareEvents.filter((event) => event.media_id === automationMeta.post_id)
      : shareEvents;
  const share = summarizeShares({
    events: scopedShareEvents,
    dms: dmLogs as ShareDmRow[],
    clicks: (linkClicksRes.data ?? []) as ShareClickRow[],
  });

  const allCommentEvents = (commentEventsRes.data ?? []) as CommentEventRow[];
  const scopedCommentEvents =
    automationMeta?.post_scope === "SPECIFIC_POST" && automationMeta.post_id
      ? allCommentEvents.filter(
          (event) => event.media_id === automationMeta.post_id
        )
      : allCommentEvents;
  const comment = summarizeComments({
    comments: scopedCommentEvents,
    dms: dmLogs as CommentDmRow[],
    clicks: (linkClicksRes.data ?? []) as CommentClickRow[],
    conversions: (conversionsRes.data ?? []) as CommentConversionRow[],
    keywords: (automationMeta?.trigger_keywords ?? []) as string[],
    timeZone,
  });

  return {
    dmSent,
    dmFailed,
    deliveryRate,
    readRate,
    linkClicks: clicks.length,
    uniqueClickers,
    conversions: conversions.length,
    revenueMinor,
    leadsCaptured,
    leadCaptureRate,
    comment,
    share,
  };
}

export async function loadCampaignAnalytics(
  workspaceId: string,
  automationId: string,
  days = 30,
  range?: { from: string; to: string },
  timeZone = DEFAULT_TIMEZONE
): Promise<CampaignAnalytics> {
  if (!hasAdminDb()) return { ...EMPTY };

  const db = getAdminDb();
  const windowDays = range
    ? Math.max(
        1,
        Math.ceil(
          (new Date(`${range.to}T23:59:59.999Z`).getTime() -
            new Date(`${range.from}T00:00:00.000Z`).getTime()) /
            86_400_000
        )
      )
    : Math.min(365, Math.max(1, Math.floor(days)));
  const toDate = range?.to ?? getTodayInTimeZone(timeZone);
  const fromDate = range?.from ?? addDaysToDateOnly(toDate, -(windowDays - 1));
  const since = zonedTimeToUtc(fromDate, timeZone).toISOString();
  const until = zonedTimeToUtc(toDate, timeZone, true).toISOString();

  const [
    dmLogsRes,
    publicRepliesRes,
    linkClicksRes,
    conversionsRes,
    vouchersRes,
    followChecksRes,
    leadEventsRes,
    automationRes,
    shareEventsRes,
    commentEventsRes,
  ] = await Promise.all([
    db
      .from("dm_logs")
      .select(
        "status, variant, message_format, recipient_id, trigger_keyword, keyword, delivered_at, read_at, post_id, sent_at"
      )
      .eq("workspace_id", workspaceId)
      .eq("automation_id", automationId)
      .gte("sent_at", since)
      .lte("sent_at", until)
      .limit(5000),
    db
      .from("public_replies")
      .select("status")
      .eq("automation_id", automationId)
      .gte("created_at", since)
      .lte("created_at", until)
      .limit(5000),
    db
      .from("link_clicks")
      .select("contact_id, is_bot, post_id, keyword")
      .eq("automation_id", automationId)
      .gte("clicked_at", since)
      .lte("clicked_at", until)
      .limit(5000),
    db
      .from("conversions")
      .select("revenue_minor, contact_id, keyword, post_id")
      .eq("workspace_id", workspaceId)
      .eq("automation_id", automationId)
      .gte("occurred_at", since)
      .lte("occurred_at", until)
      .limit(5000),
    db
      .from("dm_vouchers")
      .select("id, recipient_id")
      .eq("scope_key", `auto:${automationId}`)
      .gte("created_at", since)
      .lte("created_at", until)
      .limit(5000),
    db
      .from("follow_checks")
      .select("status")
      .eq("automation_id", automationId)
      .gte("created_at", since)
      .lte("created_at", until)
      .limit(5000),
    db
      .from("lead_events")
      .select("kind, field, value")
      .eq("automation_id", automationId)
      .gte("created_at", since)
      .lte("created_at", until)
      .limit(5000),
    db
      .from("automations")
      .select("post_scope, post_id, trigger_keywords")
      .eq("id", automationId)
      .maybeSingle(),
    db
      .from("share_events")
      .select("sender_id, media_id, title, received_at")
      .eq("workspace_id", workspaceId)
      .gte("received_at", since)
      .lte("received_at", until)
      .limit(5000),
    db
      .from("comment_events")
      .select(
        "media_id, media_type, media_product_type, commenter_id, text, received_at"
      )
      .eq("workspace_id", workspaceId)
      .gte("received_at", since)
      .lte("received_at", until)
      .limit(5000),
  ]);

  const dmLogs = dmLogsRes.data ?? [];
  const dmSent = dmLogs.filter((r) => r.status === "SENT").length;
  const dmFailed = dmLogs.filter((r) => r.status === "FAILED").length;
  const deliveryRate =
    dmSent + dmFailed > 0 ? Math.round((dmSent / (dmSent + dmFailed)) * 100) : null;
  const dmDelivered = dmLogs.filter((r) => Boolean(r.delivered_at)).length;
  const dmRead = dmLogs.filter((r) => Boolean(r.read_at)).length;
  const readRate = dmSent > 0 ? Math.round((dmRead / dmSent) * 100) : null;

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

  // Share-to-DM triggers
  const shareTriggers = dmLogs.filter(
    (r) => r.trigger_keyword === "SHARE" || r.keyword === "SHARE"
  ).length;

  // Share performance: attribute share events by the campaign's media scope.
  const automationMeta = automationRes.data as
    | { post_scope?: string | null; post_id?: string | null }
    | null;
  const shareEvents = (shareEventsRes.data ?? []) as ShareEventRow[];
  const scopedShareEvents =
    automationMeta?.post_scope === "SPECIFIC_POST" && automationMeta.post_id
      ? shareEvents.filter((event) => event.media_id === automationMeta.post_id)
      : shareEvents;
  const share = summarizeShares({
    events: scopedShareEvents,
    dms: dmLogs as ShareDmRow[],
    clicks: (linkClicksRes.data ?? []) as ShareClickRow[],
  });

  // Comment-keyword performance, scoped to the campaign's media.
  const allCommentEvents = (commentEventsRes.data ?? []) as CommentEventRow[];
  const scopedCommentEvents =
    automationMeta?.post_scope === "SPECIFIC_POST" && automationMeta.post_id
      ? allCommentEvents.filter(
          (event) => event.media_id === automationMeta.post_id
        )
      : allCommentEvents;
  const comment = summarizeComments({
    comments: scopedCommentEvents,
    dms: dmLogs as CommentDmRow[],
    clicks: (linkClicksRes.data ?? []) as CommentClickRow[],
    conversions: (conversionsRes.data ?? []) as CommentConversionRow[],
    keywords: ((automationMeta as { trigger_keywords?: string[] | null })
      ?.trigger_keywords ?? []) as string[],
    timeZone,
  });

  // Lead capture
  const leadEvents = leadEventsRes.data ?? [];
  const collectPrompts = leadEvents.filter((e) => e.kind === "prompt").length;
  const leadsCaptured = leadEvents.filter((e) => e.kind === "captured").length;
  const leadsSkipped = leadEvents.filter((e) => e.kind === "skipped").length;
  const leadCaptureRate =
    collectPrompts > 0 ? Math.round((leadsCaptured / collectPrompts) * 100) : null;

  // Previous-period comparison. The previous window ends exactly where the
  // current one starts, so the two periods never overlap.
  const currentInput: ComparisonInput = {
    dmSent,
    dmFailed,
    deliveryRate,
    readRate,
    linkClicks: clicks.length,
    uniqueClickers,
    conversions: conversions.length,
    revenueMinor,
    leadsCaptured,
    leadCaptureRate,
    comment,
    share,
  };
  const previousSince = new Date(
    new Date(since).getTime() - windowDays * 24 * 60 * 60 * 1000
  ).toISOString();
  const previousInput = await loadPreviousPeriodInput(
    db,
    workspaceId,
    automationId,
    previousSince,
    since,
    timeZone
  );
  const comparison = buildCampaignComparison(currentInput, previousInput);

  return {
    dmSent,
    dmFailed,
    deliveryRate,
    dmDelivered,
    dmRead,
    readRate,
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
    collectPrompts,
    leadsCaptured,
    leadsSkipped,
    leadCaptureRate,
    leadBreakdowns: summarizeLeadBreakdowns(leadEvents),
    shareTriggers,
    share,
    comment,
    comparison,
  };
}
