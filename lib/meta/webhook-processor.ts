import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { decryptToken } from "@/lib/meta/vault";
import { captureServerEvent } from "@/lib/posthog-server";
import {
  getUserMedia,
  postPublicCommentReply,
  sendDirectMessage,
  sendDirectMessageWithButton,
  sendPrivateReply,
  sendPrivateReplyWithButton,
  isTransientMetaError,
  type MetaApiError,
} from "@/lib/meta/client";
import {
  acquireSendSlot,
  checkRecipientCooldown,
  isViralSpike,
  pickVariant,
  randomizedDelay,
} from "@/lib/meta/safety";
import { getQstash, getQstashWorkerUrl, hasQstash } from "@/lib/upstash";
import {
  buildOpeningText,
  decideFollowGateAction,
  normalizeFollowGateConfig,
  verifyFollowership,
  type FollowGateConfig,
  type FollowVerification,
} from "@/lib/meta/follow-gate";
import { FOLLOW_GATE_LIMITS } from "@/lib/follow-gate-constants";
import { recordMetricEvent } from "@/lib/metrics";
import {
  parseCommentEvents,
  parseMessageEvents,
  parsePostbackEvents,
  parseReadEvents,
  parseShareEvents,
  parseStoryEvents,
  type WebhookCommentEvent,
  type WebhookPayload,
} from "@/lib/meta/webhook";

export type EventOutcome = "sent" | "skipped" | "failed" | "ignored";

export interface ProcessedEvent {
  kind: "comment" | "message" | "postback" | "story" | "share" | "read";
  accountId: string;
  outcome: EventOutcome;
  detail?: string;
  latencyMs?: number;
}

export interface ProcessingResult {
  events: ProcessedEvent[];
  sent: number;
  failed: number;
  skipped: number;
  avgLatencyMs: number | null;
  errors: string[];
  transientFailures: number;
  permanentFailures: number;
}

export interface AutomationLike {
  id: string;
  workspaceId: string;
  name?: string | null;
  triggerKeywords?: string[] | null;
  postScope?: string | null;
  postId?: string | null;
  dmMessage: string;
  buttonText?: string | null;
  buttonUrl?: string | null;
  publicReplyEnabled?: boolean;
  publicReplyMessages?: string[];
  followGateEnabled?: boolean;
  followGateButtonLabel?: string | null;
  followGateOnUnavailable?: string | null;
  dmVariants?: string[];
  collectField?: string | null;
  openingMessage?: string | null;
  hourlyCap?: number;
}

/** Raw `automations` row as returned by Supabase (snake_case). */
type AutomationRow = {
  id: string;
  workspace_id: string;
  name?: string | null;
  trigger_keywords?: string[] | null;
  post_scope?: string | null;
  post_id?: string | null;
  dm_message?: string | null;
  button_text?: string | null;
  button_url?: string | null;
  public_reply_enabled?: boolean | null;
  public_reply_messages?: string[] | null;
  follow_gate_enabled?: boolean | null;
  follow_gate_button_label?: string | null;
  follow_gate_on_unavailable?: string | null;
  dm_variants?: string[] | null;
  collect_field?: string | null;
  opening_message?: string | null;
  hourly_cap?: number | null;
};

/**
 * Map a database row to the shape the processor uses. Without this the live
 * webhook path would cast snake_case rows to camelCase and every field would
 * be undefined — keywords would match everything and `personalizeMessage`
 * would crash on an undefined template.
 */
export function toAutomationLike(row: AutomationRow): AutomationLike {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    triggerKeywords: row.trigger_keywords ?? [],
    postScope: row.post_scope,
    postId: row.post_id,
    dmMessage: row.dm_message ?? "",
    buttonText: row.button_text,
    buttonUrl: row.button_url,
    publicReplyEnabled: row.public_reply_enabled ?? false,
    publicReplyMessages: row.public_reply_messages ?? [],
    followGateEnabled: row.follow_gate_enabled ?? false,
    followGateButtonLabel: row.follow_gate_button_label ?? null,
    followGateOnUnavailable: row.follow_gate_on_unavailable ?? "hold",
    dmVariants: row.dm_variants ?? [],
    collectField: row.collect_field,
    openingMessage: row.opening_message,
    hourlyCap: row.hourly_cap ?? 0,
  };
}

interface DmRule {
  id: string;
  workspace_id: string;
  name: string;
  trigger_type: string;
  keywords: string[];
  message: string;
  variants: string[];
  button_text: string | null;
  button_url: string | null;
  collect_field: string | null;
  follow_gate_enabled: boolean | null;
  opening_message: string | null;
  follow_gate_button_label: string | null;
  follow_gate_on_unavailable: string | null;
  once_per_days: number;
  priority: number;
}

/** Small jitter to spread bursts against Meta's per-token rate limits. */
export function jitter(minMs = 50, maxMs = 350): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, randomizedDelay(minMs, maxMs))
  );
}

/** Retry Meta calls on rate-limit and transient error codes with backoff. */
export async function withRetry<T extends { error?: MetaApiError }>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  let attempt = 0;
  while (true) {
    const result = await fn();
    const errorCode = result?.error?.error?.code ?? result?.error?.code;
    const isRateLimit = errorCode === 32 || errorCode === 613 || errorCode === 429;
    const isTransient = errorCode === 1 || errorCode === 2 || errorCode === 100;

    if ((!isRateLimit && !isTransient) || attempt >= maxRetries) return result;
    attempt++;
    await jitter(500 * attempt, 500 * attempt);
  }
}

/** Replaces {username}, {link} and {keyword} placeholders in DM templates. */
export function personalizeMessage(
  template: string | null | undefined,
  vars: { username?: string; link?: string; keyword?: string }
): string {
  return (template ?? "")
    .replace(/\{username\}/gi, vars.username || "there")
    .replace(/\{link\}/gi, vars.link || "")
    .replace(/\{keyword\}/gi, vars.keyword || "");
}

/**
 * Adds short attribution params to the real destination URL. We deliberately
 * do not replace it with a signed /go/ token: Instagram does not linkify those
 * long URLs in DM text, and the creator asked for the actual link to be sent.
 */
export function linkForMessage(url: string, campaignId: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("utm_source", "dmplease");
    parsed.searchParams.set("utm_medium", "instagram_dm");
    parsed.searchParams.set("utm_campaign", campaignId.slice(0, 8));
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Instagram only linkifies a URL when it is a clean, whitespace-delimited
 * token. Bare URLs embedded mid-sentence often arrive as plain text, so pull
 * every URL onto its own line and strip attached punctuation.
 */
export function formatDmText(
  template: string,
  vars: { username?: string; link?: string; keyword?: string }
): string {
  return personalizeMessage(template, vars)
    .replace(/https?:\/\/[^\s<]+/g, (url) => {
      const clean = url.replace(/[.,;:!?)\]}]+$/g, "");
      return `\n\n${clean}\n`;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

/** Returns true when the automation should run for this media item. */
export async function matchesPostScope(
  auto: { postScope?: string | null; postId?: string | null },
  event: { mediaId: string },
  token: string,
  latestMediaCache: Map<string, Promise<string | null>>
): Promise<boolean> {
  if (auto.postScope === "SPECIFIC_POST") {
    return Boolean(auto.postId && auto.postId === event.mediaId);
  }
  if (auto.postScope === "NEXT_POST") {
    let pending = latestMediaCache.get(token);
    if (!pending) {
      pending = getUserMedia(token, 1)
        .then((media) => media[0]?.id ?? null)
        .catch(() => null);
      latestMediaCache.set(token, pending);
    }
    const latestId = await pending;
    return Boolean(latestId && latestId === event.mediaId);
  }
  return true;
}

/** Substring keyword match; empty keyword list means "any keyword". */
export function findMatchingKeyword(
  keywords: string[] | null | undefined,
  text: string
): string | null {
  if (!keywords || keywords.length === 0) return "AUTO_MATCH";
  const normalized = text.toLowerCase().trim();
  return (
    keywords.find((keyword) =>
      normalized.includes(keyword.toLowerCase().trim())
    ) ?? null
  );
}

/** Whole-word matching for inbox DM rules. */
export function matchesRuleKeywords(keywords: string[], text: string): boolean {
  if (keywords.length === 0) return true;
  const words = new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  return keywords.some((keyword) => words.has(keyword.toLowerCase().trim()));
}

// ── Persistence helpers (Supabase HTTPS REST via service role) ──────────────

function nowIso() {
  return new Date().toISOString();
}

function metaErrorCode(error: MetaApiError | undefined): number | null {
  const code = error?.error?.code ?? error?.code;
  return typeof code === "number" ? code : null;
}

/** Human-readable reason stored in the job ledger and shown in diagnostics. */
function describeMetaError(error: MetaApiError | undefined): string {
  if (!error) return "Unknown Meta error";
  const code = metaErrorCode(error);
  const message = error.error?.message ?? error.message ?? "request rejected";
  return code === null ? message : `Meta error ${code}: ${message}`;
}

/**
 * Meta code 190 means the stored token can no longer authenticate. Retrying
 * cannot fix it, so we mark the account as needing reconnection and raise an
 * in-app alert instead of silently failing every future comment.
 */
async function markTokenInvalid(
  accountDbId: string | null | undefined,
  workspaceId: string | null | undefined,
  errorMessage: string
): Promise<void> {
  if (!hasAdminDb() || !accountDbId) return;
  const now = new Date().toISOString();
  try {
    await getAdminDb()
      .from("instagram_accounts")
      .update({
        token_status: "invalid",
        token_last_error: errorMessage.slice(0, 500),
        token_checked_at: now,
      })
      .eq("id", accountDbId);

    await getAdminDb().from("admin_alerts").insert({
      kind: "instagram_token_invalid",
      severity: "critical",
      title: "Instagram account needs reconnection",
      body: `Meta rejected the stored access token (${errorMessage}). Automated DMs are paused until this account is reconnected. Workspace: ${workspaceId ?? "unknown"}`,
      metrics: { account_id: accountDbId, workspace_id: workspaceId ?? null },
      email_status: "not_configured",
    });
  } catch (error) {
    console.warn("[webhook] Could not record invalid-token alert:", error);
  }

  captureServerEvent({
    event: "instagram_token_invalid",
    properties: { account_id: accountDbId, error: errorMessage.slice(0, 120) },
    anonymous: true,
  });
}

async function getAccount(instagramId: string) {
  if (!hasAdminDb()) return null;
  try {
    const { data, error } = await getAdminDb()
      .from("instagram_accounts")
      .select("id, workspace_id, access_token")
      .eq("instagram_id", instagramId)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data
      ? {
          id: data.id as string,
          workspace_id: data.workspace_id as string,
          access_token: (data.access_token as string | null) ?? null,
        }
      : null;
  } catch {
    return null;
  }
}

async function getToken(instagramId: string, account: { access_token: string | null } | null): Promise<string | null> {
  if (account?.access_token) {
    try {
      return decryptToken(account.access_token);
    } catch (error) {
      console.warn("[webhook] Could not decrypt account token:", error);
    }
  }
  return process.env.INSTAGRAM_ACCESS_TOKEN ?? null;
}

async function ensureContact(
  workspaceId: string,
  instagramId: string,
  username?: string | null,
  source = "comment"
): Promise<string | null> {
  if (!hasAdminDb()) return null;
  try {
    const payload: Record<string, unknown> = {
      workspace_id: workspaceId,
      instagram_id: instagramId,
      source,
      updated_at: nowIso(),
    };
    if (username) payload.username = username;
    const { data, error } = await getAdminDb()
      .from("contacts")
      .upsert(payload, { onConflict: "workspace_id,instagram_id" })
      .select("id")
      .single();
    if (error) throw error;
    return (data?.id as string) ?? null;
  } catch (error) {
    console.warn("[webhook] ensureContact failed:", error);
    return null;
  }
}

async function ensureConversation(
  workspaceId: string,
  instagramAccountId: string | null,
  contactId: string
): Promise<string | null> {
  if (!hasAdminDb()) return null;
  try {
    const { data, error } = await getAdminDb()
      .from("conversations")
      .upsert(
        {
          workspace_id: workspaceId,
          contact_id: contactId,
          ...(instagramAccountId ? { instagram_account_id: instagramAccountId } : {}),
          status: "open",
          last_message_at: nowIso(),
        },
        { onConflict: "contact_id,instagram_account_id" }
      )
      .select("id")
      .single();
    if (error) throw error;
    return (data?.id as string) ?? null;
  } catch (error) {
    console.warn("[webhook] ensureConversation failed:", error);
    return null;
  }
}

async function recordMessage(input: {
  workspaceId: string;
  conversationId: string;
  externalId?: string | null;
  direction: "inbound" | "outbound";
  senderType: "contact" | "bot" | "agent";
  text: string;
  status?: string | null;
}): Promise<boolean> {
  if (!hasAdminDb()) return false;
  try {
    const payload: Record<string, unknown> = {
      workspace_id: input.workspaceId,
      conversation_id: input.conversationId,
      external_id: input.externalId ?? null,
      direction: input.direction,
      sender_type: input.senderType,
      content_type: "text",
      content: { text: input.text },
      delivery_status: input.status ?? null,
    };
    const { error } = await getAdminDb()
      .from("messages")
      .upsert(payload, { onConflict: "conversation_id,external_id", ignoreDuplicates: true });
    if (error) throw error;
    await getAdminDb()
      .from("conversations")
      .update({ last_message_at: nowIso() })
      .eq("id", input.conversationId);
    return true;
  } catch (error) {
    console.warn("[webhook] recordMessage failed:", error);
    return false;
  }
}

async function recordSafety(input: {
  workspaceId: string;
  instagramAccountId?: string | null;
  recipientId?: string | null;
  kind?: string;
}): Promise<void> {
  if (!hasAdminDb()) return;
  try {
    await getAdminDb().from("safety_events").insert({
      workspace_id: input.workspaceId,
      instagram_account_id: input.instagramAccountId ?? null,
      recipient_id: input.recipientId ?? null,
      kind: input.kind ?? "dm",
    });
  } catch {
    // Safety ledger is best-effort.
  }
}

async function getRules(
  workspaceId: string,
  triggerTypes: string[]
): Promise<DmRule[]> {
  if (!hasAdminDb()) return [];
  try {
    // Select * and normalise: gate columns are additive, so installations
    // that have not applied the latest migration must keep working.
    const { data, error } = await getAdminDb()
      .from("dm_rules")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("active", true)
      .in("trigger_type", triggerTypes)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true });
    if (error) throw error;
    return ((data ?? []) as DmRule[]).map((rule) => ({
      ...rule,
      keywords: rule.keywords ?? [],
      variants: rule.variants ?? [],
      follow_gate_enabled: Boolean(rule.follow_gate_enabled),
      opening_message: rule.opening_message ?? null,
      follow_gate_button_label: rule.follow_gate_button_label ?? null,
      follow_gate_on_unavailable: rule.follow_gate_on_unavailable ?? "hold",
    }));
  } catch {
    return [];
  }
}

async function recentlyMessaged(
  workspaceId: string,
  recipientId: string,
  ruleId: string,
  days: number
): Promise<boolean> {
  if (!hasAdminDb()) return false;
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await getAdminDb()
      .from("safety_events")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("recipient_id", recipientId)
      .eq("kind", `rule:${ruleId}`)
      .gt("created_at", since)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return Boolean(data);
  } catch {
    return false;
  }
}

async function persistCommentEvent(
  workspaceId: string,
  accountId: string | null,
  event: WebhookCommentEvent
): Promise<void> {
  if (!hasAdminDb()) return;
  try {
    const { error } = await getAdminDb()
      .from("comment_events")
      .upsert(
        {
          workspace_id: workspaceId,
          instagram_account_id: accountId,
          external_id: event.commentId,
          media_id: event.mediaId,
          commenter_id: event.commenterId,
          commenter_username: event.commenterName ?? null,
          text: event.commentText,
        },
        { onConflict: "workspace_id,external_id", ignoreDuplicates: true }
      );
    if (error) throw error;
  } catch (error) {
    console.warn("[webhook] Could not persist comment event:", error);
  }
}

async function createPending(input: {
  workspaceId: string;
  kind: string;
  automationId?: string | null;
  ruleId?: string | null;
  instagramAccountId?: string | null;
  recipientId: string;
  commentId?: string | null;
  message?: string | null;
  buttonText?: string | null;
  buttonUrl?: string | null;
  collectField?: string | null;
}): Promise<string | null> {
  if (!hasAdminDb()) return null;
  try {
    const { data, error } = await getAdminDb()
      .from("pending_dms")
      .insert({
        workspace_id: input.workspaceId,
        kind: input.kind,
        automation_id: input.automationId ?? null,
        rule_id: input.ruleId ?? null,
        instagram_account_id: input.instagramAccountId ?? null,
        recipient_id: input.recipientId,
        comment_id: input.commentId ?? null,
        message: input.message ?? null,
        button_text: input.buttonText ?? null,
        button_url: input.buttonUrl ?? null,
        collect_field: input.collectField ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;
    return (data?.id as string) ?? null;
  } catch (error) {
    console.warn("[webhook] Could not create pending DM:", error);
    return null;
  }
}

async function consumePending(id: string) {
  if (!hasAdminDb()) return null;
  try {
    const { data, error } = await getAdminDb()
      .from("pending_dms")
      .select("id, workspace_id, kind, automation_id, rule_id, instagram_account_id, recipient_id, comment_id, message, button_text, button_url, collect_field")
      .eq("id", id)
      .gt("expires_at", nowIso())
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      id: data.id as string,
      workspace_id: data.workspace_id as string,
      kind: data.kind as string,
      automation_id: (data.automation_id as string | null) ?? null,
      rule_id: (data.rule_id as string | null) ?? null,
      instagram_account_id: (data.instagram_account_id as string | null) ?? null,
      recipient_id: data.recipient_id as string,
      comment_id: (data.comment_id as string | null) ?? null,
      message: (data.message as string | null) ?? null,
      button_text: (data.button_text as string | null) ?? null,
      button_url: (data.button_url as string | null) ?? null,
      collect_field: (data.collect_field as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

async function deletePending(id: string): Promise<void> {
  if (!hasAdminDb()) return;
  try {
    await getAdminDb().from("pending_dms").delete().eq("id", id);
  } catch {
    // Best effort.
  }
}

async function markContactLedger(
  workspaceId: string,
  recipientId: string,
  field: "opted_in_at" | "follow_verified_at" | "email" | "phone" | "display_name",
  value: string
): Promise<void> {
  if (!hasAdminDb()) return;
  try {
    const patch: Record<string, unknown> = { updated_at: nowIso() };
    if (field === "email") patch.email = value;
    else if (field === "phone") patch.phone = value;
    else if (field === "display_name") patch.display_name = value;
    else if (field === "opted_in_at") patch.opted_in_at = nowIso();
    else patch.follow_verified_at = nowIso();

    await getAdminDb()
      .from("contacts")
      .update(patch)
      .eq("workspace_id", workspaceId)
      .eq("instagram_id", recipientId);
  } catch (error) {
    console.warn("[webhook] Could not update contact:", error);
  }
}

// ── Ask for Follow ───────────────────────────────────────────────────────────

/** Fills additive DM-rule columns for databases that predate the gate migration. */
function toDmRule(row: Partial<DmRule> & Record<string, unknown>): DmRule {
  return {
    id: String(row.id),
    workspace_id: String(row.workspace_id),
    name: String(row.name ?? "Rule"),
    trigger_type: String(row.trigger_type ?? "DM_KEYWORD"),
    keywords: (row.keywords as string[] | null) ?? [],
    message: String(row.message ?? ""),
    variants: (row.variants as string[] | null) ?? [],
    button_text: (row.button_text as string | null) ?? null,
    button_url: (row.button_url as string | null) ?? null,
    collect_field: (row.collect_field as string | null) ?? null,
    follow_gate_enabled: Boolean(row.follow_gate_enabled),
    opening_message: (row.opening_message as string | null) ?? null,
    follow_gate_button_label: (row.follow_gate_button_label as string | null) ?? null,
    follow_gate_on_unavailable: (row.follow_gate_on_unavailable as string | null) ?? "hold",
    once_per_days: Number(row.once_per_days ?? 45),
    priority: Number(row.priority ?? 0),
  };
}

async function contactUsername(
  workspaceId: string,
  recipientId: string
): Promise<string | null> {
  if (!hasAdminDb()) return null;
  try {
    const { data } = await getAdminDb()
      .from("contacts")
      .select("username")
      .eq("workspace_id", workspaceId)
      .eq("instagram_id", recipientId)
      .maybeSingle();
    return data?.username ? String(data.username) : null;
  } catch {
    return null;
  }
}

/**
 * A short-lived verification is enough to avoid a Meta call on every comment
 * in an active conversation. Both timestamps are required so an opt-in that
 * was never confirmed can never count as verified.
 */
async function isRecentlyVerified(
  workspaceId: string,
  recipientId: string
): Promise<boolean> {
  if (!hasAdminDb()) return false;
  try {
    const { data } = await getAdminDb()
      .from("contacts")
      .select("opted_in_at, follow_verified_at")
      .eq("workspace_id", workspaceId)
      .eq("instagram_id", recipientId)
      .maybeSingle();
    if (!data?.opted_in_at || !data.follow_verified_at) return false;
    const verifiedAt = new Date(String(data.follow_verified_at)).getTime();
    if (Number.isNaN(verifiedAt)) return false;
    return Date.now() - verifiedAt < FOLLOW_GATE_LIMITS.verificationCacheMinutes * 60 * 1000;
  } catch {
    return false;
  }
}

async function setFollowVerification(
  workspaceId: string,
  recipientId: string,
  verified: boolean
): Promise<void> {
  if (!hasAdminDb()) return;
  try {
    const patch: Record<string, unknown> = {
      follow_verified_at: verified ? nowIso() : null,
      updated_at: nowIso(),
    };
    if (verified) {
      const { data } = await getAdminDb()
        .from("contacts")
        .select("opted_in_at")
        .eq("workspace_id", workspaceId)
        .eq("instagram_id", recipientId)
        .maybeSingle();
      if (!data?.opted_in_at) patch.opted_in_at = nowIso();
    }
    await getAdminDb()
      .from("contacts")
      .update(patch)
      .eq("workspace_id", workspaceId)
      .eq("instagram_id", recipientId);
  } catch (error) {
    console.warn("[follow-gate] Could not update verification ledger:", error);
  }
}

async function recordFollowCheck(input: {
  workspaceId: string;
  accountDbId?: string | null;
  automationId?: string | null;
  ruleId?: string | null;
  pendingId?: string | null;
  promptId?: string | null;
  recipientId: string;
  verification: Pick<FollowVerification, "status" | "method" | "reason"> & {
    fromCache?: boolean;
  };
}): Promise<void> {
  if (!hasAdminDb()) return;
  try {
    await getAdminDb().from("follow_checks").insert({
      workspace_id: input.workspaceId,
      instagram_account_id: input.accountDbId ?? null,
      automation_id: input.automationId ?? null,
      rule_id: input.ruleId ?? null,
      pending_id: input.pendingId ?? null,
      prompt_id: input.promptId ?? null,
      recipient_id: input.recipientId,
      status: input.verification.status,
      method: input.verification.method,
      reason: input.verification.reason ?? null,
      created_at: nowIso(),
    });
  } catch {
    // Ledger is best-effort; never block a DM on analytics.
  }
}

async function countFollowChecksForPending(pendingId: string): Promise<number> {
  if (!hasAdminDb()) return 0;
  try {
    const { count, error } = await getAdminDb()
      .from("follow_checks")
      .select("id", { count: "exact", head: true })
      .eq("pending_id", pendingId);
    if (error) throw error;
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function findPendingOptin(
  workspaceId: string,
  recipientId: string,
  automationId: string | null,
  ruleId: string | null
) {
  if (!hasAdminDb()) return null;
  try {
    let query = getAdminDb()
      .from("pending_dms")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("recipient_id", recipientId)
      .eq("kind", "optin")
      .gt("expires_at", nowIso())
      .order("created_at", { ascending: false })
      .limit(1);
    if (automationId) query = query.eq("automation_id", automationId);
    else if (ruleId) query = query.eq("rule_id", ruleId);
    const { data, error } = await query;
    if (error) throw error;
    return data?.[0]?.id ? String(data[0].id) : null;
  } catch {
    return null;
  }
}

export interface FollowGateOutcome {
  proceed: boolean;
  skipped?: string;
  verification?: FollowVerification;
}

/**
 * Shared gate used by comment automations and every rule trigger.
 *
 * Confirmed followers proceed immediately, confirmed non-followers receive an
 * opening DM with an opt-in button, and verification outages follow the
 * creator's explicit hold/deliver policy (never a silent fail-open).
 */
async function applyFollowGate(input: {
  workspaceId: string;
  accountDbId: string | null;
  accountId: string;
  token: string;
  recipientId: string;
  username?: string | null;
  config: FollowGateConfig;
  automationId?: string | null;
  ruleId?: string | null;
  commentId?: string | null;
  keyword?: string | null;
  deliverMessage: string;
  buttonUrl?: string | null;
}): Promise<FollowGateOutcome> {
  if (!input.config.enabled) return { proceed: true };

  if (await isRecentlyVerified(input.workspaceId, input.recipientId)) {
    const cached: FollowVerification = {
      status: "follower",
      method: "none",
      reason: "recent_verification",
      checkedAt: nowIso(),
      fromCache: true,
    };
    await recordFollowCheck({
      workspaceId: input.workspaceId,
      accountDbId: input.accountDbId,
      automationId: input.automationId,
      ruleId: input.ruleId,
      recipientId: input.recipientId,
      verification: cached,
    });
    return { proceed: true, verification: cached };
  }

  const verification = await verifyFollowership(
    input.token,
    input.accountId,
    input.recipientId
  );
  await recordFollowCheck({
    workspaceId: input.workspaceId,
    accountDbId: input.accountDbId,
    automationId: input.automationId,
    ruleId: input.ruleId,
    recipientId: input.recipientId,
    verification,
  });
  captureServerEvent({
    event: "follow_gate_checked",
    properties: {
      status: verification.status,
      method: verification.method,
      reason: verification.reason ?? null,
      automation_id: input.automationId ?? null,
      rule_id: input.ruleId ?? null,
    },
    anonymous: true,
  });

  if (verification.status === "follower") {
    await setFollowVerification(input.workspaceId, input.recipientId, true);
    return { proceed: true, verification };
  }

  if (decideFollowGateAction(input.config, verification) === "deliver") {
    await recordSafety({
      workspaceId: input.workspaceId,
      instagramAccountId: input.accountDbId,
      recipientId: input.recipientId,
      kind: "follow_gate_exception",
    });
    return { proceed: true, verification };
  }

  // Ask the person to follow, then verify again on the postback (consent).
  const existing = await findPendingOptin(
    input.workspaceId,
    input.recipientId,
    input.automationId ?? null,
    input.ruleId ?? null
  );
  if (existing) {
    return {
      proceed: false,
      skipped: "Opening DM already sent; waiting for follow confirmation",
      verification,
    };
  }

  const pendingId = await createPending({
    workspaceId: input.workspaceId,
    kind: "optin",
    automationId: input.automationId ?? null,
    ruleId: input.ruleId ?? null,
    instagramAccountId: input.accountDbId,
    recipientId: input.recipientId,
    commentId: input.commentId ?? null,
    message: input.deliverMessage,
    buttonText: input.config.buttonLabel,
    buttonUrl: input.buttonUrl ?? null,
  });
  if (!pendingId) {
    return { proceed: false, skipped: "Could not create opt-in record", verification };
  }

  const openingText = buildOpeningText(input.config, {
    username: input.username,
    keyword: input.keyword,
    link: input.buttonUrl,
  });
  const dispatch = () =>
    input.commentId
      ? sendPrivateReplyWithButton(
          input.token,
          input.accountId,
          input.commentId!,
          openingText,
          input.config.buttonLabel,
          `OPTIN:${pendingId}`
        )
      : sendDirectMessageWithButton(
          input.token,
          input.accountId,
          input.recipientId,
          openingText,
          input.config.buttonLabel,
          `OPTIN:${pendingId}`
        );

  const outcome = await withRetry(dispatch, 2);
  const code = metaErrorCode(outcome?.error);
  if (code === 190) {
    await markTokenInvalid(
      input.accountDbId,
      input.workspaceId,
      "Meta error 190: invalid OAuth access token"
    );
    return { proceed: false, skipped: "Token invalid — reconnect required", verification };
  }
  if (outcome?.error) {
    await deletePending(pendingId);
    return { proceed: false, skipped: "Could not send the opening DM", verification };
  }

  await recordSafety({
    workspaceId: input.workspaceId,
    instagramAccountId: input.accountDbId,
    recipientId: input.recipientId,
    kind: "follow_gate_opening",
  });
  captureServerEvent({
    event: "follow_gate_opening_sent",
    properties: {
      automation_id: input.automationId ?? null,
      rule_id: input.ruleId ?? null,
      reason: verification.reason ?? verification.status,
    },
    anonymous: true,
  });
  return {
    proceed: false,
    skipped: "Opening DM sent; waiting for follow confirmation",
    verification,
  };
}

/** Delivers content released by an opt-in postback for a DM/story/share rule. */
async function sendRuleOptinDm(input: {
  token: string;
  accountId: string;
  accountDbId: string | null;
  workspaceId: string;
  recipientId: string;
  rule: DmRule;
  message: string;
}): Promise<{ sent: boolean; error?: MetaApiError }> {
  const variant = pickVariant(input.rule.variants ?? []);
  const vars = {
    username: (await contactUsername(input.workspaceId, input.recipientId)) ?? "there",
    link: input.rule.button_url ?? "",
    keyword: input.rule.keywords?.[0] ?? "",
  };
  const text = formatDmText(variant.text ?? input.message, vars);
  const result = await withRetry(
    () =>
      input.rule.button_text && input.rule.button_url
        ? sendDirectMessage(
            input.token,
            input.accountId,
            input.recipientId,
            `${text}\n\n${input.rule.button_text}: ${personalizeMessage(input.rule.button_url, vars)}`
          )
        : sendDirectMessage(input.token, input.accountId, input.recipientId, text),
    3
  );
  const sent = !result?.error;

  if (sent) {
    await recordMetricEvent({
      kind: "dm_sent",
      creatorId: input.workspaceId,
      targetId: input.rule.id,
    });
    await recordSafety({
      workspaceId: input.workspaceId,
      instagramAccountId: input.accountDbId,
      recipientId: input.recipientId,
      kind: `rule:${input.rule.id}`,
    });
  }

  if (hasAdminDb()) {
    const contactId = await ensureContact(
      input.workspaceId,
      input.recipientId,
      undefined,
      "optin"
    );
    const conversationId = contactId
      ? await ensureConversation(input.workspaceId, input.accountDbId, contactId)
      : null;
    if (conversationId) {
      await recordMessage({
        workspaceId: input.workspaceId,
        conversationId,
        externalId: result?.message_id ?? null,
        direction: "outbound",
        senderType: "bot",
        text,
        status: sent ? "sent" : "failed",
      });
    }
    await getAdminDb().from("dm_logs").insert({
      workspace_id: input.workspaceId,
      instagram_account_id: input.accountDbId,
      recipient_id: input.recipientId,
      trigger_keyword: "OPTIN",
      dm_message: text,
      status: sent ? "SENT" : "FAILED",
      keyword: "OPTIN",
      sequence_step: 2,
      variant: variant.text ? "variant" : "default",
    });
  }

  return { sent, error: result?.error };
}

/** Loads the live gate policy for an outstanding opt-in (creator may have edited it). */
async function loadPendingGateConfig(pending: {
  workspace_id: string;
  automation_id: string | null;
  rule_id: string | null;
  message: string | null;
  button_text: string | null;
}): Promise<{ config: FollowGateConfig; rule: DmRule | null }> {
  let config = normalizeFollowGateConfig({
    enabled: true,
    openingMessage: pending.message,
    buttonLabel: pending.button_text,
    onUnavailable: "hold",
  });
  let rule: DmRule | null = null;

  if (pending.rule_id && hasAdminDb()) {
    const { data } = await getAdminDb()
      .from("dm_rules")
      .select("*")
      .eq("id", pending.rule_id)
      .maybeSingle();
    if (data) {
      rule = toDmRule(data as Partial<DmRule> & Record<string, unknown>);
      config = normalizeFollowGateConfig({
        enabled: true,
        openingMessage: rule.opening_message ?? pending.message,
        buttonLabel: rule.follow_gate_button_label ?? pending.button_text,
        onUnavailable: rule.follow_gate_on_unavailable ?? "hold",
      });
    }
  } else if (pending.automation_id && hasAdminDb()) {
    const { data } = await getAdminDb()
      .from("automations")
      .select("opening_message, follow_gate_button_label, follow_gate_on_unavailable")
      .eq("id", pending.automation_id)
      .maybeSingle();
    if (data) {
      config = normalizeFollowGateConfig({
        enabled: true,
        openingMessage: (data.opening_message as string | null) ?? pending.message,
        buttonLabel: (data.follow_gate_button_label as string | null) ?? pending.button_text,
        onUnavailable: (data.follow_gate_on_unavailable as string | null) ?? "hold",
      });
    }
  }

  return { config, rule };
}

interface PendingOptinDelivery {
  id: string;
  workspace_id: string;
  automation_id: string | null;
  rule_id: string | null;
  comment_id: string | null;
  message: string | null;
  button_url: string | null;
  button_text: string | null;
}

/**
 * Single release path for a verified opt-in, used by both the button postback
 * and an inbound DM reply (either action gives Meta the required consent).
 */
async function releasePendingOptin(input: {
  pending: PendingOptinDelivery;
  rule: DmRule | null;
  token: string;
  accountId: string;
  accountDbId: string;
  userId: string;
}): Promise<{ sent: boolean; error?: MetaApiError }> {
  const { pending, rule } = input;

  if (rule) {
    return sendRuleOptinDm({
      token: input.token,
      accountId: input.accountId,
      accountDbId: input.accountDbId,
      workspaceId: pending.workspace_id,
      recipientId: input.userId,
      rule,
      message: pending.message ?? rule.message,
    });
  }

  if (pending.comment_id && pending.automation_id && hasAdminDb()) {
    const { data: autoRow } = await getAdminDb()
      .from("automations")
      .select("id, workspace_id, dm_message, button_text, button_url, public_reply_enabled, public_reply_messages, hourly_cap, dm_variants, trigger_keywords")
      .eq("id", pending.automation_id)
      .maybeSingle();
    if (autoRow) {
      const auto = toAutomationLike(autoRow as AutomationRow);
      const contactId = await ensureContact(
        auto.workspaceId,
        input.userId,
        undefined,
        "optin"
      );
      let postId: string | null = null;
      const { data: sourceComment } = await getAdminDb()
        .from("comment_events")
        .select("media_id")
        .eq("workspace_id", auto.workspaceId)
        .eq("external_id", pending.comment_id!)
        .maybeSingle();
      postId = (sourceComment?.media_id as string | null) ?? null;

      return sendOptinDm({
        token: input.token,
        accountId: input.accountId,
        accountDbId: input.accountDbId,
        workspaceId: auto.workspaceId,
        recipientId: input.userId,
        auto,
        contactId,
        postId,
        keyword: auto.triggerKeywords?.[0] ?? "OPTIN",
      });
    }
  }

  // Generic pending message (legacy opt-ins or rule rows that disappeared).
  const username = await contactUsername(pending.workspace_id, input.userId);
  const text = formatDmText(pending.message ?? "", {
    username: username ?? undefined,
    link: pending.button_url ?? "",
    keyword: "OPTIN",
  });
  const result = await withRetry(
    () => sendDirectMessage(input.token, input.accountId, input.userId, text),
    3
  );
  const sent = !result?.error;
  if (sent) {
    await recordMetricEvent({
      kind: "dm_sent",
      creatorId: pending.workspace_id,
      targetId: pending.id,
    });
    await recordSafety({
      workspaceId: pending.workspace_id,
      instagramAccountId: input.accountDbId,
      recipientId: input.userId,
    });
  }
  if (hasAdminDb()) {
    const contactId = await ensureContact(
      pending.workspace_id,
      input.userId,
      undefined,
      "optin"
    );
    const conversationId = contactId
      ? await ensureConversation(pending.workspace_id, input.accountDbId, contactId)
      : null;
    if (conversationId) {
      await recordMessage({
        workspaceId: pending.workspace_id,
        conversationId,
        externalId: result?.message_id ?? null,
        direction: "outbound",
        senderType: "bot",
        text,
        status: sent ? "sent" : "failed",
      });
    }
    await getAdminDb().from("dm_logs").insert({
      workspace_id: pending.workspace_id,
      instagram_account_id: input.accountDbId,
      recipient_id: input.userId,
      trigger_keyword: "OPTIN",
      dm_message: text,
      status: sent ? "SENT" : "FAILED",
      keyword: "OPTIN",
      sequence_step: 2,
    });
  }
  return { sent, error: result?.error };
}

// ── In-chat "Ask to follow" prompts ─────────────────────────────────────────

interface FollowPromptRow {
  id: string;
  workspace_id: string;
  contact_id: string | null;
  conversation_id: string | null;
  pending_id: string | null;
  recipient_id: string;
  source: string;
  status: string;
  prior_follower: boolean | null;
  handle: string | null;
  promised_content: string | null;
  created_at: string;
  tapped_at: string | null;
  resolved_at: string | null;
  delivered_at: string | null;
}

async function getFollowPromptByPending(
  pendingId: string
): Promise<FollowPromptRow | null> {
  if (!hasAdminDb()) return null;
  try {
    const { data, error } = await getAdminDb()
      .from("follow_prompts")
      .select("*")
      .eq("pending_id", pendingId)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data as FollowPromptRow | null) ?? null;
  } catch {
    return null;
  }
}

async function updateFollowPrompt(
  id: string,
  patch: Partial<Pick<FollowPromptRow, "status" | "tapped_at" | "resolved_at" | "delivered_at">>
): Promise<void> {
  if (!hasAdminDb()) return;
  try {
    await getAdminDb().from("follow_prompts").update(patch).eq("id", id);
  } catch {
    // Analytics ledger is best-effort.
  }
}

/**
 * Resolves an in-chat follow prompt after a tap or DM reply.
 * Hard gate: content is released only after Meta confirms the follow.
 */
async function resolveFollowPrompt(input: {
  prompt: FollowPromptRow;
  pending: PendingOptinDelivery;
  token: string;
  accountId: string;
  accountDbId: string;
  userId: string;
  verification: FollowVerification;
}): Promise<{ sent: boolean; skipped?: string; error?: MetaApiError }> {
  const { prompt, pending, verification } = input;
  await recordFollowCheck({
    workspaceId: prompt.workspace_id,
    accountDbId: input.accountDbId,
    recipientId: input.userId,
    pendingId: pending.id,
    promptId: prompt.id,
    verification,
  });

  const hardGate = normalizeFollowGateConfig({
    enabled: true,
    onUnavailable: "hold",
  });
  const decision = decideFollowGateAction(hardGate, verification);

  if (decision === "ask") {
    const checks = await countFollowChecksForPending(pending.id);
    const expired = checks >= FOLLOW_GATE_LIMITS.maxChecksPerPending;
    await updateFollowPrompt(prompt.id, {
      status: expired ? "expired" : verification.status,
      tapped_at: prompt.tapped_at ?? nowIso(),
      resolved_at: expired ? nowIso() : null,
    });
    if (expired) await deletePending(pending.id);
    await withRetry(
      () =>
        sendDirectMessage(
          input.token,
          input.accountId,
          input.userId,
          expired
            ? "This offer has expired. Message us again and we'll send it right over."
            : "Almost there — follow the account, then tap the button again so we can confirm."
        ),
      2
    );
    return { sent: false, skipped: expired ? "Follow prompt expired" : "Follow not confirmed" };
  }

  // Confirmed follower (or an explicit deliver policy).
  await updateFollowPrompt(prompt.id, {
    status: "follower",
    tapped_at: prompt.tapped_at ?? nowIso(),
    resolved_at: nowIso(),
  });
  await setFollowVerification(prompt.workspace_id, input.userId, true);
  await markContactLedger(prompt.workspace_id, input.userId, "opted_in_at", nowIso());

  if (prompt.prior_follower === false) {
    await recordSafety({
      workspaceId: prompt.workspace_id,
      instagramAccountId: input.accountDbId,
      recipientId: input.userId,
      kind: "follow_growth",
    });
    captureServerEvent({
      event: "follow_growth_attributed",
      properties: {
        prompt_id: prompt.id,
        source: prompt.source,
        conversation_id: prompt.conversation_id ?? null,
      },
      anonymous: true,
    });
  }

  let outcome: { sent: boolean; error?: MetaApiError };
  if (pending.message || prompt.promised_content) {
    outcome = await releasePendingOptin({
      pending: { ...pending, message: pending.message ?? prompt.promised_content },
      rule: null,
      token: input.token,
      accountId: input.accountId,
      accountDbId: input.accountDbId,
      userId: input.userId,
    });
  } else {
    const result = await withRetry(
      () =>
        sendDirectMessage(
          input.token,
          input.accountId,
          input.userId,
          "Thanks for following! 🎉 You're all set."
        ),
      3
    );
    outcome = { sent: !result?.error, error: result?.error };
    if (hasAdminDb()) {
      const contactId = await ensureContact(
        prompt.workspace_id,
        input.userId,
        undefined,
        "follow_prompt"
      );
      const conversationId = contactId
        ? await ensureConversation(prompt.workspace_id, input.accountDbId, contactId)
        : prompt.conversation_id;
      if (conversationId) {
        await recordMessage({
          workspaceId: prompt.workspace_id,
          conversationId,
          externalId: result?.message_id ?? null,
          direction: "outbound",
          senderType: "bot",
          text: "Thanks for following! 🎉 You're all set.",
          status: outcome.sent ? "sent" : "failed",
        });
      }
      await getAdminDb().from("dm_logs").insert({
        workspace_id: prompt.workspace_id,
        instagram_account_id: input.accountDbId,
        recipient_id: input.userId,
        trigger_keyword: "FOLLOW_CONFIRMED",
        dm_message: "Thanks for following! 🎉 You're all set.",
        status: outcome.sent ? "SENT" : "FAILED",
        keyword: "FOLLOW_CONFIRMED",
        sequence_step: 2,
      });
    }
  }

  if (outcome.sent) {
    await updateFollowPrompt(prompt.id, { delivered_at: nowIso() });
    await deletePending(pending.id);
  }
  return outcome;
}

// ── Dispatch helpers ─────────────────────────────────────────────────────────

async function sendCommentDm(input: {
  token: string;
  accountId: string;
  commentId: string;
  workspaceId: string;
  recipientId: string;
  username?: string;
  auto: AutomationLike;
  keyword: string;
  contactId: string | null;
  accountDbId: string | null;
  event?: WebhookCommentEvent;
  attempts?: number;
}): Promise<{ sent: boolean; error?: MetaApiError }> {
  const { auto } = input;
  const cap = auto.hourlyCap ?? 0;
  const limit = await acquireSendSlot(`${input.accountId}:${auto.id}`, cap);
  if (!limit.allowed) {
    const attempts = input.attempts ?? 0;
    if (input.event && attempts < 3 && hasQstash()) {
      try {
        const base = new URL(getQstashWorkerUrl()).origin;
        const delay = Math.max(1, Math.ceil(limit.retryAfterMs / 1000));
        await getQstash().publishJSON({
          url: `${base}/api/workers/send-queued-dm`,
          body: { event: input.event, auto, attempts: attempts + 1 },
          delay,
          retries: 2,
          label: ["dm-overflow"],
        });
        console.warn(
          `[safety] Hourly cap reached for ${auto.name}; delayed ${delay}s (attempt ${attempts + 1})`
        );
        return { sent: false };
      } catch (error) {
        console.warn("[safety] Delayed overflow publish failed:", error);
      }
    }

    await createPending({
      workspaceId: input.workspaceId,
      kind: "queued",
      automationId: auto.id,
      instagramAccountId: input.accountDbId,
      recipientId: input.recipientId,
      commentId: input.commentId,
      message: auto.dmMessage,
      buttonText: auto.buttonText,
      buttonUrl: auto.buttonUrl,
    });
    console.warn(`[safety] Hourly cap reached for ${auto.name}; message parked (retry in ${limit.retryAfterMs}ms)`);
    return { sent: false };
  }

  const variants = auto.dmVariants ?? [];
  const variant = pickVariant(variants);
  const template = variant.text ?? auto.dmMessage;
  const vars = {
    username: input.username || "there",
    link: auto.buttonUrl || "",
    keyword: input.keyword,
  };
  const text = formatDmText(template, vars);
  await jitter(50, 350);

  const dispatch = () =>
    auto.buttonText && auto.buttonUrl
      ? sendPrivateReplyWithButton(
          input.token,
          input.accountId,
          input.commentId,
          text,
          personalizeMessage(auto.buttonText, vars),
          linkForMessage(personalizeMessage(auto.buttonUrl, vars), auto.id)
        )
      : sendPrivateReply(input.token, input.accountId, input.commentId, text);

  const result = await withRetry(dispatch, 3);
  const succeeded = !result?.error;

  if (succeeded) {
    await recordSafety({
      workspaceId: input.workspaceId,
      instagramAccountId: input.accountDbId,
      recipientId: input.recipientId,
    });
    await recordMetricEvent({
      kind: "dm_sent",
      creatorId: input.workspaceId,
      targetId: auto.id,
    });

    if (auto.publicReplyEnabled) {
      const replies = auto.publicReplyMessages ?? [];
      const replyText = replies.length
        ? replies[Math.floor(Math.random() * replies.length)]
        : "Sent you a DM! 📩";
      await withRetry(
        () => postPublicCommentReply(input.token, input.commentId, personalizeMessage(replyText, vars)),
        2
      );
    }

    if (input.contactId && auto.collectField) {
      await createPending({
        workspaceId: input.workspaceId,
        kind: "collect",
        automationId: auto.id,
        instagramAccountId: input.accountDbId,
        recipientId: input.recipientId,
        message: `Reply with your ${auto.collectField} to finish claiming this.`,
        collectField: auto.collectField,
      });
    }
  }

  await getAdminDb().from("dm_logs").insert({
    workspace_id: input.workspaceId,
    instagram_account_id: input.accountDbId,
    automation_id: auto.id,
    recipient_id: input.recipientId,
    recipient_username: input.username || "instagram_user",
    trigger_keyword: input.keyword,
    dm_message: text,
    status: succeeded ? "SENT" : "FAILED",
    post_id: input.event?.mediaId ?? null,
    keyword: input.keyword,
    sequence_step: 1,
    variant: variant?.text ? "variant" : "default",
  });

  if (input.contactId) {
    const conversationId = await ensureConversation(
      input.workspaceId,
      input.accountDbId,
      input.contactId
    );
    if (conversationId) {
      await recordMessage({
        workspaceId: input.workspaceId,
        conversationId,
        externalId: result?.message_id ?? null,
        direction: "outbound",
        senderType: "bot",
        text,
        status: succeeded ? "sent" : "failed",
      });
    }
  }

  return { sent: succeeded, error: succeeded ? undefined : result.error };
}

/**
 * Exported for the retro re-run endpoint. Applies one stored comment event to
 * one automation with the same guards as live webhook delivery.
 */
export async function processCommentEventForAutomation(
  event: WebhookCommentEvent,
  auto: AutomationLike,
  attempts = 0
): Promise<{ sent: boolean; skipped?: string; error?: MetaApiError }> {
  if (!hasAdminDb()) return { sent: false, skipped: "Database unavailable" };

  const account = await getAccount(event.instagramAccountId);
  if (!account) return { sent: false, skipped: "Account not connected" };
  const token = await getToken(event.instagramAccountId, account);
  if (!token) return { sent: false, skipped: "No valid access token" };

  const latestMediaCache = new Map<string, Promise<string | null>>();
  const matchedKeyword = findMatchingKeyword(auto.triggerKeywords, event.commentText);
  if (matchedKeyword === null) return { sent: false, skipped: "No keyword match" };
  if (!(await matchesPostScope(auto, event, token, latestMediaCache))) {
    return { sent: false, skipped: "Post scope mismatch" };
  }

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: existing } = await getAdminDb()
    .from("dm_logs")
    .select("id")
    .eq("automation_id", auto.id)
    .eq("recipient_id", event.commenterId)
    // A FAILED delivery is not a delivered message. Without this filter a
    // single rejected DM blocks every future comment from that person for 24h.
    .eq("status", "SENT")
    .gte("sent_at", dayAgo)
    .limit(1)
    .maybeSingle();
  if (existing) return { sent: false, skipped: "Already messaged in 24h" };

  const cooldownOk = await checkRecipientCooldown(
    event.instagramAccountId,
    event.mediaId,
    event.commenterId
  );
  if (!cooldownOk) return { sent: false, skipped: "Recipient cooldown (10 min per post)" };

  const contactId = await ensureContact(
    auto.workspaceId,
    event.commenterId,
    event.commenterName,
    "comment"
  );

  if (auto.followGateEnabled) {
    const gate = await applyFollowGate({
      workspaceId: auto.workspaceId,
      accountDbId: account.id,
      accountId: event.instagramAccountId,
      token,
      recipientId: event.commenterId,
      username: event.commenterName,
      config: normalizeFollowGateConfig({
        enabled: true,
        openingMessage: auto.openingMessage,
        buttonLabel: auto.followGateButtonLabel,
        onUnavailable: auto.followGateOnUnavailable,
      }),
      automationId: auto.id,
      commentId: event.commentId,
      keyword: matchedKeyword,
      deliverMessage: auto.dmMessage,
      buttonUrl: auto.buttonUrl,
    });
    if (!gate.proceed) {
      return {
        sent: false,
        skipped: gate.skipped ?? "Follow gate: not confirmed",
      };
    }
  }

  const dispatch = await sendCommentDm({
    token,
    accountId: event.instagramAccountId,
    commentId: event.commentId,
    workspaceId: auto.workspaceId,
    recipientId: event.commenterId,
    username: event.commenterName,
    auto,
    keyword: matchedKeyword,
    contactId,
    accountDbId: account.id,
    event,
    attempts,
  });

  if (dispatch.sent) return { sent: true };

  const code = metaErrorCode(dispatch.error);
  if (code === 190) {
    await markTokenInvalid(
      account.id,
      auto.workspaceId,
      "Meta error 190: invalid OAuth access token"
    );
    return {
      sent: false,
      skipped: "Token invalid — reconnect required",
      error: dispatch.error,
    };
  }

  return {
    sent: false,
    skipped: "Meta rejected the DM or cap reached",
    error: dispatch.error,
  };
}

async function processDirectRule(input: {
  workspaceId: string;
  accountId: string;
  accountDbId: string | null;
  token: string;
  recipientId: string;
  username?: string;
  rule: DmRule;
  externalId?: string;
  matchedText?: string;
}): Promise<boolean> {
  const { rule } = input;
  if (await recentlyMessaged(input.workspaceId, input.recipientId, rule.id, rule.once_per_days)) {
    return false;
  }

  const contactId = await ensureContact(
    input.workspaceId,
    input.recipientId,
    input.username,
    `rule:${rule.trigger_type}`
  );

  // Ask for Follow now works on inbox, story and share rules too. The opening
  // DM is a direct message (there is no comment to reply to) and verification
  // happens on the postback, once Meta has user consent.
  if (rule.follow_gate_enabled) {
    const gate = await applyFollowGate({
      workspaceId: input.workspaceId,
      accountDbId: input.accountDbId,
      accountId: input.accountId,
      token: input.token,
      recipientId: input.recipientId,
      username: input.username,
      config: normalizeFollowGateConfig({
        enabled: true,
        openingMessage: rule.opening_message,
        buttonLabel: rule.follow_gate_button_label,
        onUnavailable: rule.follow_gate_on_unavailable,
      }),
      ruleId: rule.id,
      keyword: input.matchedText ?? rule.keywords?.[0] ?? "",
      deliverMessage: rule.message,
      buttonUrl: rule.button_url,
    });
    if (!gate.proceed) return false;
  }

  const conversationId = contactId
    ? await ensureConversation(input.workspaceId, input.accountDbId, contactId)
    : null;

  const variant = pickVariant(rule.variants);
  const text = formatDmText(variant.text ?? rule.message, {
    username: input.username,
    link: rule.button_url ?? "",
    keyword: input.matchedText ?? "",
  });

  await jitter(50, 350);
  // Always send the real destination URL in DM text. Long signed /go/ links
  // are not rendered as clickable links by Instagram.
  const result = await withRetry(() =>
    rule.button_text && rule.button_url
      ? sendDirectMessage(
          input.token,
          input.accountId,
          input.recipientId,
          `${text}\n\n${rule.button_text}: ${personalizeMessage(rule.button_url, { username: input.username })}`
        )
      : sendDirectMessage(input.token, input.accountId, input.recipientId, text)
  );

  const succeeded = !result?.error;
  await recordSafety({
    workspaceId: input.workspaceId,
    instagramAccountId: input.accountDbId,
    recipientId: input.recipientId,
    kind: `rule:${rule.id}`,
  });
  if (succeeded) {
    await recordMetricEvent({
      kind: "dm_sent",
      creatorId: input.workspaceId,
      targetId: rule.id,
    });
  }

  if (conversationId) {
    await recordMessage({
      workspaceId: input.workspaceId,
      conversationId,
      externalId: result?.message_id ?? input.externalId ?? null,
      direction: "outbound",
      senderType: "bot",
      text,
      status: succeeded ? "sent" : "failed",
    });
  }

  if (hasAdminDb()) {
    await getAdminDb().from("dm_logs").insert({
      workspace_id: input.workspaceId,
      instagram_account_id: input.accountDbId,
      automation_id: null,
      recipient_id: input.recipientId,
      recipient_username: input.username || "instagram_user",
      trigger_keyword: input.matchedText || rule.keywords?.[0] || "DM_RULE",
      dm_message: text,
      status: succeeded ? "SENT" : "FAILED",
      keyword: (input.matchedText || rule.keywords?.[0] || "DM_RULE").toUpperCase(),
      sequence_step: 1,
      variant: variant.text ? "variant" : "default",
    });
  }

  if (succeeded && rule.collect_field && contactId) {
    await createPending({
      workspaceId: input.workspaceId,
      kind: "collect",
      ruleId: rule.id,
      instagramAccountId: input.accountDbId,
      recipientId: input.recipientId,
      message: `Reply with your ${rule.collect_field} to finish.`,
      collectField: rule.collect_field,
    });
  }

  return succeeded;
}

/**
 * After a button tap the original comment already has a private reply, and
 * Meta only allows one per comment. The guide must therefore be sent as a
 * direct message to the follower's IGSID, not as another comment reply.
 */
export async function sendOptinDm(input: {
  token: string;
  accountId: string;
  accountDbId: string;
  workspaceId: string;
  recipientId: string;
  auto: AutomationLike;
  contactId: string | null;
  postId?: string | null;
  keyword?: string;
}): Promise<{ sent: boolean; error?: MetaApiError }> {
  const variants = input.auto.dmVariants ?? [];
  const variant = pickVariant(variants);
  const template = variant.text ?? input.auto.dmMessage ?? "";

  // Send the real destination URL. A signed /go/ token is ~290 characters and
  // Instagram does not render it as a clickable link in DM text. Short UTM
  // parameters keep attribution without breaking the link.
  const link = linkForMessage(
    personalizeMessage(input.auto.buttonUrl || "", { keyword: "OPTIN" }),
    input.auto.id
  );

  let username = "there";
  if (hasAdminDb()) {
    const { data: contact } = await getAdminDb()
      .from("contacts")
      .select("username")
      .eq("workspace_id", input.workspaceId)
      .eq("instagram_id", input.recipientId)
      .maybeSingle();
    if (contact?.username) username = String(contact.username);
  }

  const text = formatDmText(template, {
    username,
    link,
    keyword: "OPTIN",
  });

  const response = await withRetry(
    () =>
      sendDirectMessage(
        input.token,
        input.accountId,
        input.recipientId,
        text
      ),
    3
  );
  const sent = !response?.error;

  if (sent) {
    await recordMetricEvent({
      kind: "dm_sent",
      creatorId: input.workspaceId,
      targetId: input.auto.id,
    });
    await recordSafety({
      workspaceId: input.workspaceId,
      instagramAccountId: input.accountDbId,
      recipientId: input.recipientId,
    });
  }

  if (hasAdminDb()) {
    await getAdminDb().from("dm_logs").insert({
      workspace_id: input.workspaceId,
      instagram_account_id: input.accountDbId,
      automation_id: input.auto.id,
      recipient_id: input.recipientId,
      recipient_username: "instagram_user",
      trigger_keyword: "OPTIN",
      dm_message: text,
      status: sent ? "SENT" : "FAILED",
      post_id: input.postId ?? null,
      keyword: input.keyword ?? "OPTIN",
      sequence_step: 2,
      variant: variant.text ? "variant" : "default",
    });
  }

  return { sent, error: response?.error };
}

// ── Main orchestrator ────────────────────────────────────────────────────────

export async function processWebhookPayload(
  payload: WebhookPayload
): Promise<ProcessingResult> {
  const result: ProcessingResult = {
    events: [],
    sent: 0,
    failed: 0,
    skipped: 0,
    avgLatencyMs: null,
    errors: [],
    transientFailures: 0,
    permanentFailures: 0,
  };
  const latencies: number[] = [];
  const dbAvailable = hasAdminDb();

  if (!dbAvailable) {
    result.errors.push("DATABASE_URL is not configured; webhook events were not persisted.");
  }

  // ── Comments → DM ────────────────────────────────────────────────────────────
  for (const event of parseCommentEvents(payload)) {
    const startedAt = Date.now();
    if (!dbAvailable) {
      result.events.push({ kind: "comment", accountId: event.instagramAccountId, outcome: "skipped", detail: "Database unavailable" });
      result.skipped++;
      continue;
    }
    try {
      const account = await getAccount(event.instagramAccountId);
      if (!account) {
        result.events.push({ kind: "comment", accountId: event.instagramAccountId, outcome: "skipped", detail: "Account not connected" });
        result.skipped++;
        continue;
      }
      await persistCommentEvent(account.workspace_id, account.id, event);

      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { count: recentCount } = await getAdminDb()
        .from("comment_events")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", account.workspace_id)
        .gte("received_at", fiveMinutesAgo);
      if (isViralSpike(recentCount ?? 0)) {
        console.warn("[safety] Viral spike detected — throttling delivery");
        await jitter(500, 2000);
      }

      const { data: automationRows } = await getAdminDb()
        .from("automations")
        .select("*")
        .eq("workspace_id", account.workspace_id)
        .eq("active", true);
      const automations = (automationRows ?? []).map((row) =>
        toAutomationLike(row as AutomationRow)
      );

      if (automations.length === 0) {
        result.events.push({ kind: "comment", accountId: event.instagramAccountId, outcome: "skipped", detail: "No active automation" });
        result.skipped++;
        continue;
      }

      for (const auto of automations as AutomationLike[]) {
        try {
          const outcome = await processCommentEventForAutomation(event, auto);
          const latencyMs = Date.now() - startedAt;
          latencies.push(latencyMs);
          result.events.push({
            kind: "comment",
            accountId: event.instagramAccountId,
            outcome: outcome.sent ? "sent" : "skipped",
            detail: outcome.skipped ?? auto.name ?? "automation",
            latencyMs,
          });
          if (outcome.sent) {
            result.sent++;
          } else if (outcome.error) {
            if (isTransientMetaError(outcome.error)) result.transientFailures++;
            else result.permanentFailures++;
            result.failed++;
            // The ledger needs a reason: without this the job is marked FAILED
            // with a null error and diagnostics cannot explain the failure.
            result.errors.push(
              `Comment ${event.commentId} on automation ${auto.name ?? auto.id}: ${describeMetaError(outcome.error)}`
            );
          } else {
            result.skipped++;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown error";
          result.errors.push(`Automation "${auto.name ?? auto.id}" failed: ${message}`);
          result.events.push({ kind: "comment", accountId: event.instagramAccountId, outcome: "failed", detail: message });
          result.failed++;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      result.errors.push(`Comment event ${event.commentId} failed: ${message}`);
      result.events.push({ kind: "comment", accountId: event.instagramAccountId, outcome: "failed", detail: message });
      result.failed++;
    }
  }

  // ── Inbound DMs → keyword rules / lead capture ──────────────────────────────
  for (const event of parseMessageEvents(payload)) {
    try {
      const account = await getAccount(event.instagramAccountId);
      if (!account) continue;
      const token = await getToken(event.instagramAccountId, account);
      const contactId = await ensureContact(account.workspace_id, event.senderId, undefined, "dm");
      const conversationId = contactId
        ? await ensureConversation(account.workspace_id, account.id, contactId)
        : null;
      if (conversationId) {
        await recordMessage({
          workspaceId: account.workspace_id,
          conversationId,
          externalId: event.messageId,
          direction: "inbound",
          senderType: "contact",
          text: event.messageText,
        });
      }
      await recordMetricEvent({
        kind: "dm_reply",
        creatorId: account.workspace_id,
        targetId: account.id,
      });

      // A reply to a lead-capture question is stored on the contact first.
      const { data: pendingRows } = await getAdminDb()
        .from("pending_dms")
        .select("id, collect_field")
        .eq("workspace_id", account.workspace_id)
        .eq("recipient_id", event.senderId)
        .eq("kind", "collect")
        .gt("expires_at", nowIso())
        .order("created_at", { ascending: false })
        .limit(1);
      const pending = pendingRows?.[0];
      if (pending?.collect_field) {
        const field = pending.collect_field;
        if (field === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(event.messageText)) {
          if (conversationId) {
            await recordMessage({
              workspaceId: account.workspace_id,
              conversationId,
              direction: "outbound",
              senderType: "bot",
              text: "That email doesn't look right. Please try again.",
            });
          }
          continue;
        }
        await markContactLedger(
          account.workspace_id,
          event.senderId,
          field === "email" ? "email" : field === "phone" ? "phone" : "display_name",
          event.messageText
        );
        await deletePending(pending.id);
      }

      // Ask for Follow: replying to the opening DM also grants Meta consent,
      // so a plain reply can satisfy an outstanding opt-in just like a tap.
      if (token) {
        const { data: optinRows } = await getAdminDb()
          .from("pending_dms")
          .select("id, workspace_id, automation_id, rule_id, comment_id, message, button_url, button_text")
          .eq("workspace_id", account.workspace_id)
          .eq("recipient_id", event.senderId)
          .eq("kind", "optin")
          .gt("expires_at", nowIso())
          .order("created_at", { ascending: false })
          .limit(1);
        const optin = optinRows?.[0] as PendingOptinDelivery | undefined;
        if (optin) {
          // A DM reply also grants consent, so it can confirm an in-chat prompt.
          const inChatPrompt = await getFollowPromptByPending(optin.id);
          if (inChatPrompt) {
            const verification = await verifyFollowership(
              token,
              event.instagramAccountId,
              event.senderId
            );
            const resolved = await resolveFollowPrompt({
              prompt: inChatPrompt,
              pending: optin,
              token,
              accountId: event.instagramAccountId,
              accountDbId: account.id,
              userId: event.senderId,
              verification,
            });
            if (resolved.sent) {
              result.events.push({ kind: "message", accountId: event.instagramAccountId, outcome: "sent", detail: "Follow confirmed — content delivered" });
              result.sent++;
            } else if (resolved.error) {
              result.errors.push(`Follow prompt reply failed: ${describeMetaError(resolved.error)}`);
              result.events.push({ kind: "message", accountId: event.instagramAccountId, outcome: "failed", detail: "Follow prompt delivery failed" });
              result.failed++;
            } else {
              result.events.push({ kind: "message", accountId: event.instagramAccountId, outcome: "skipped", detail: resolved.skipped ?? "Follow not confirmed" });
              result.skipped++;
            }
            continue;
          }

          const { config, rule } = await loadPendingGateConfig({
            workspace_id: optin.workspace_id,
            automation_id: optin.automation_id,
            rule_id: optin.rule_id,
            message: optin.message,
            button_text: optin.button_text ?? null,
          });
          const verification = await verifyFollowership(
            token,
            event.instagramAccountId,
            event.senderId
          );
          await recordFollowCheck({
            workspaceId: optin.workspace_id,
            accountDbId: account.id,
            automationId: optin.automation_id,
            ruleId: optin.rule_id,
            pendingId: optin.id,
            recipientId: event.senderId,
            verification,
          });

          if (decideFollowGateAction(config, verification) === "ask") {
            const checks = await countFollowChecksForPending(optin.id);
            if (checks >= FOLLOW_GATE_LIMITS.maxChecksPerPending) {
              await deletePending(optin.id);
            }
            await withRetry(
              () =>
                sendDirectMessage(
                  token,
                  event.instagramAccountId,
                  event.senderId,
                  "Almost there — follow the account, then tap the button again so I can confirm."
                ),
              2
            );
            result.events.push({
              kind: "message",
              accountId: event.instagramAccountId,
              outcome: "skipped",
              detail: "Follow gate: not confirmed",
            });
            result.skipped++;
            continue;
          }

          if (verification.status === "unavailable") {
            await recordSafety({
              workspaceId: optin.workspace_id,
              instagramAccountId: account.id,
              recipientId: event.senderId,
              kind: "follow_gate_exception",
            });
          }
          await setFollowVerification(optin.workspace_id, event.senderId, true);
          await markContactLedger(optin.workspace_id, event.senderId, "opted_in_at", nowIso());
          const released = await releasePendingOptin({
            pending: optin,
            rule,
            token,
            accountId: event.instagramAccountId,
            accountDbId: account.id,
            userId: event.senderId,
          });
          if (released.sent) {
            await deletePending(optin.id);
            result.events.push({ kind: "message", accountId: event.instagramAccountId, outcome: "sent", detail: "Follow confirmed — DM delivered" });
            result.sent++;
          } else {
            result.errors.push(`Opt-in reply delivery failed: ${describeMetaError(released.error)}`);
            result.events.push({ kind: "message", accountId: event.instagramAccountId, outcome: "failed", detail: "Follow confirmed, delivery failed" });
            result.failed++;
          }
          continue;
        }
      }

      const rules = await getRules(account.workspace_id, ["DM_KEYWORD"]);
      if (!token) continue;

      let handled = false;
      for (const rule of rules) {
        if (!matchesRuleKeywords(rule.keywords, event.messageText)) continue;
        const succeeded = await processDirectRule({
          workspaceId: account.workspace_id,
          accountId: event.instagramAccountId,
          accountDbId: account.id,
          token,
          recipientId: event.senderId,
          rule,
          externalId: event.messageId,
          matchedText: event.messageText,
        });
        result.events.push({
          kind: "message",
          accountId: event.instagramAccountId,
          outcome: succeeded ? "sent" : "skipped",
          detail: rule.name,
        });
        if (succeeded) result.sent++;
        else result.skipped++;
        handled = true;
        break; // highest-priority matching rule wins
      }
      if (!handled) {
        result.events.push({ kind: "message", accountId: event.instagramAccountId, outcome: "ignored", detail: "No matching DM rule" });
      }
    } catch (error) {
      result.errors.push(`Inbound DM ${event.messageId} failed: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  // ── Postbacks → opt-in, tags, follow-ups ────────────────────────────────────
  for (const event of parsePostbackEvents(payload)) {
    try {
      const [action, value] = event.payload.split(":");
      const account = await getAccount(event.instagramAccountId);
      if (!account) continue;
      const token = await getToken(event.instagramAccountId, account);
      if (!token) continue;

      if (action === "OPTIN" && value) {
        const pending = await consumePending(value);
        if (!pending) {
          result.events.push({ kind: "postback", accountId: event.instagramAccountId, outcome: "skipped", detail: "Opt-in link expired" });
          result.skipped++;
          continue;
        }

        // In-chat "Ask to follow" prompts have their own hard-gate resolver.
        const inChatPrompt = await getFollowPromptByPending(value);
        if (inChatPrompt) {
          const verification = await verifyFollowership(
            token,
            event.instagramAccountId,
            event.userId
          );
          const resolved = await resolveFollowPrompt({
            prompt: inChatPrompt,
            pending,
            token,
            accountId: event.instagramAccountId,
            accountDbId: account.id,
            userId: event.userId,
            verification,
          });
          if (resolved.sent) {
            result.events.push({ kind: "postback", accountId: event.instagramAccountId, outcome: "sent", detail: "Follow confirmed — content delivered" });
            result.sent++;
          } else if (resolved.error) {
            result.errors.push(`Follow prompt ${value} failed: ${describeMetaError(resolved.error)}`);
            result.events.push({ kind: "postback", accountId: event.instagramAccountId, outcome: "failed", detail: "Follow prompt delivery failed" });
            result.failed++;
          } else {
            result.events.push({ kind: "postback", accountId: event.instagramAccountId, outcome: "skipped", detail: resolved.skipped ?? "Follow not confirmed" });
            result.skipped++;
          }
          continue;
        }

        // Re-load the gate policy: the creator may have edited it while the
        // opening DM was outstanding.
        const { config, rule: pendingRule } = await loadPendingGateConfig(pending);

        // Consent now exists (the person tapped our button), so Meta can
        // answer is_user_follow_business reliably.
        const verification = await verifyFollowership(
          token,
          event.instagramAccountId,
          event.userId
        );
        await recordFollowCheck({
          workspaceId: pending.workspace_id,
          accountDbId: account.id,
          automationId: pending.automation_id,
          ruleId: pending.rule_id,
          pendingId: value,
          recipientId: event.userId,
          verification,
        });

        if (decideFollowGateAction(config, verification) === "ask") {
          const checks = await countFollowChecksForPending(value);
          const expired = checks >= FOLLOW_GATE_LIMITS.maxChecksPerPending;
          if (expired) await deletePending(value);
          await withRetry(
            () =>
              sendDirectMessage(
                token,
                event.instagramAccountId,
                event.userId,
                expired
                  ? "This link has expired. Comment or message again and I'll send it straight away."
                  : "Almost there — follow the account, then tap the button again so I can confirm."
              ),
            2
          );
          result.events.push({
            kind: "postback",
            accountId: event.instagramAccountId,
            outcome: "skipped",
            detail: expired ? "Follow gate: attempts exhausted" : "Follow gate: not confirmed",
          });
          result.skipped++;
          continue;
        }

        if (verification.status === "unavailable") {
          await recordSafety({
            workspaceId: pending.workspace_id,
            instagramAccountId: account.id,
            recipientId: event.userId,
            kind: "follow_gate_exception",
          });
        }
        await setFollowVerification(pending.workspace_id, event.userId, true);
        await markContactLedger(pending.workspace_id, event.userId, "opted_in_at", nowIso());

        const released = await releasePendingOptin({
          pending,
          rule: pendingRule,
          token,
          accountId: event.instagramAccountId,
          accountDbId: account.id,
          userId: event.userId,
        });
        if (released.sent) {
          await deletePending(value);
          result.events.push({ kind: "postback", accountId: event.instagramAccountId, outcome: "sent", detail: "Follow confirmed — DM delivered" });
          result.sent++;
        } else {
          // Keep the pending row so the follower can try again after a
          // transient failure instead of losing the lead permanently.
          const code = metaErrorCode(released.error);
          if (code === 190) {
            await markTokenInvalid(
              account.id,
              pending.workspace_id,
              "Meta error 190: invalid OAuth access token"
            );
          }
          result.errors.push(`Postback ${value} failed: ${describeMetaError(released.error)}`);
          result.events.push({ kind: "postback", accountId: event.instagramAccountId, outcome: "failed", detail: `Meta error ${code ?? "unknown"}` });
          result.failed++;
          if (code !== null && !isTransientMetaError({ error: { code } } as MetaApiError)) {
            result.permanentFailures++;
          } else {
            result.transientFailures++;
          }
        }
        continue;
      }

      if (action === "TAG" && value) {
        if (hasAdminDb()) {
          const { data: taggedContact } = await getAdminDb()
            .from("contacts")
            .select("tags")
            .eq("workspace_id", account.workspace_id)
            .eq("instagram_id", event.userId)
            .maybeSingle();
          const tags = (taggedContact?.tags as string[] | null) ?? [];
          if (!tags.includes(value)) {
            await getAdminDb()
              .from("contacts")
              .update({ tags: [...tags, value], updated_at: nowIso() })
              .eq("workspace_id", account.workspace_id)
              .eq("instagram_id", event.userId);
          }
        }
        result.events.push({ kind: "postback", accountId: event.instagramAccountId, outcome: "sent", detail: `Tagged: ${value}` });
        result.sent++;
        continue;
      }

      result.events.push({ kind: "postback", accountId: event.instagramAccountId, outcome: "ignored", detail: event.payload });
    } catch (error) {
      result.errors.push(`Postback ${event.payload} failed: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  // ── Story mentions / replies ────────────────────────────────────────────────
  for (const event of parseStoryEvents(payload)) {
    try {
      const account = await getAccount(event.instagramAccountId);
      if (!account) continue;
      const rules = (await getRules(account.workspace_id, ["STORY_MENTION", "STORY_REPLY"])).filter(
        (rule) =>
          rule.trigger_type === (event.kind === "MENTION" ? "STORY_MENTION" : "STORY_REPLY") &&
          matchesRuleKeywords(rule.keywords, event.text ?? "")
      );
      const token = await getToken(event.instagramAccountId, account);
      if (!token) continue;

      if (rules.length === 0) {
        result.events.push({ kind: "story", accountId: event.instagramAccountId, outcome: "ignored", detail: "No matching story rule" });
        continue;
      }
      // Only one live story rule should fire per mention (Zorcha parity).
      const succeeded = await processDirectRule({
        workspaceId: account.workspace_id,
        accountId: event.instagramAccountId,
        accountDbId: account.id,
        token,
        recipientId: event.senderId,
        username: event.senderName,
        rule: rules[0],
        externalId: `story:${event.externalId}`,
      });
      result.events.push({
        kind: "story",
        accountId: event.instagramAccountId,
        outcome: succeeded ? "sent" : "skipped",
        detail: rules[0].name,
      });
      if (succeeded) result.sent++;
      else result.skipped++;
    } catch (error) {
      result.errors.push(`Story event failed: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  // ── Shares to DMs ───────────────────────────────────────────────────────────
  for (const event of parseShareEvents(payload)) {
    try {
      const account = await getAccount(event.instagramAccountId);
      if (!account) continue;
      const rules = await getRules(account.workspace_id, ["SHARE_TO_DM"]);
      const token = await getToken(event.instagramAccountId, account);
      if (!token || rules.length === 0) continue;
      const succeeded = await processDirectRule({
        workspaceId: account.workspace_id,
        accountId: event.instagramAccountId,
        accountDbId: account.id,
        token,
        recipientId: event.senderId,
        username: event.senderName,
        rule: rules[0],
        externalId: `share:${event.messageId}`,
        matchedText: event.title ?? "",
      });
      result.events.push({
        kind: "share",
        accountId: event.instagramAccountId,
        outcome: succeeded ? "sent" : "skipped",
        detail: rules[0].name,
      });
      if (succeeded) result.sent++;
      else result.skipped++;
    } catch (error) {
      result.errors.push(`Share event failed: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  parseReadEvents(payload);

  result.avgLatencyMs = latencies.length
    ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
    : null;

  return result;
}
