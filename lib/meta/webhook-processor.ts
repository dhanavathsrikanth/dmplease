import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { decryptToken } from "@/lib/meta/vault";
import { claimDmSend, releaseDmSend } from "@/lib/dm-send-claim";
import { captureServerEvent } from "@/lib/posthog-server";
import {
  postPublicCommentReply,
  sendDirectMessage,
  sendDirectMessageWithButton,
  sendDirectMessageWithAttachment,
  sendPrivateReply,
  sendPrivateReplyWithButton,
  sendPrivateReplyWithAttachment,
  isTransientMetaError,
  type MetaApiError,
} from "@/lib/meta/client";
import {
  acquireSendSlot,
  checkRecipientCooldown,
  hasRepliedRecently,
  isViralSpike,
  markReplied,
  randomizedDelay,
} from "@/lib/meta/rate-limit";
import { ACCOUNT_HOURLY_CEILING } from "@/lib/meta/limits";
import {
  isSkipKeyword,
  normalizeCollectConfig,
  parseCollectField,
  renderCollectPrompt,
  validateLeadValue,
  type CollectConfig,
} from "@/lib/lead-capture";
import { getQstash, getQstashWorkerUrl, getRedis, hasQstash, hasUpstashRedis } from "@/lib/upstash";
import {
  decideFollowGateAction,
  normalizeFollowGateConfig,
  verifyFollowership,
  type FollowGateConfig,
  type FollowVerification,
} from "@/lib/meta/follow-gate";
import {
  normalizeOpeningTemplate,
  renderOpeningDm,
  type OpeningDmTemplate,
} from "@/lib/meta/opening-dm";
import { FOLLOW_GATE_LIMITS, isRecentInbound } from "@/lib/follow-gate-constants";
import { getWorkspaceTimeZone } from "@/lib/workspace-preferences";
import {
  fallbackAsRule,
  matchesRuleKeywords,
  normalizeFallbackReply,
  pickDispatchableCandidate,
  selectInboundRule,
  selectInboundRuleCandidates,
  type DispatchRule,
  type FallbackRow,
  type RuleCandidate,
} from "@/lib/dm-rules";

// Kept exported for existing callers/tests; the implementation now lives in
// the pure dm-rules decision modules.
export { matchesRuleKeywords };
export {
  formatDmText,
  linkForMessage,
  personalizeMessage,
} from "@/lib/meta/dm-template";
import {
  formatDmText,
  personalizeMessage,
} from "@/lib/meta/dm-template";
import { buildAutomationContent } from "@/lib/meta/dm-content";
import { resolveDmVars } from "@/lib/meta/dm-variable-resolver";
import type { DmVars } from "@/lib/dm-variables";
import type { MessageFormatConfig } from "@/lib/message-formats";
import { normalizeDmVariants } from "@/lib/dm-variants";
import {
  chooseVariant,
  variantFingerprint,
  type VariantChoice,
} from "@/lib/message-variants";
import {
  getRecentVariantFingerprints,
  recordVariantFingerprint,
} from "@/lib/meta/variant-history";
import { isAutoReelLink } from "@/lib/reel-link";
import { resolveLatestMedia } from "@/lib/meta/reel-link-resolver";
import { recordSendOutcome } from "@/lib/meta/account-health";
import {
  acquireThrottleSlot,
  recordCommentVelocity,
} from "@/lib/meta/throttle";
import { enqueueQueuedDm } from "@/lib/dm-queue";
import {
  choosePublicReply,
  normalizePublicReplies,
  renderPublicReply,
} from "@/lib/public-replies";
import {
  getRecentPublicReplyFingerprints,
  recordPublicReplyFingerprint,
} from "@/lib/meta/public-reply-rotation";
import { recordMetricEvent } from "@/lib/metrics";
import {
  parseCommentEvents,
  parseDeliveryEvents,
  parseMessageEvents,
  parsePostbackEvents,
  parseReactionEvents,
  parseReadEvents,
  parseShareEvents,
  parseStoryEvents,
  parseStoryInsightEvents,
  type WebhookCommentEvent,
  type WebhookPayload,
  type WebhookPostbackEvent,
  type WebhookShareEvent,
} from "@/lib/meta/webhook";

export type EventOutcome = "sent" | "skipped" | "failed" | "ignored";

export interface ProcessedEvent {
  kind: "comment" | "message" | "postback" | "story" | "share" | "read" | "reaction";
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
  triggerType?: string | null;
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
  collectRetryMessage?: string | null;
  collectSkipMessage?: string | null;
  collectSuccessMessage?: string | null;
  collectSkipKeywords?: string[] | null;
  collectMaxAttempts?: number | null;
  openingMessage?: string | null;
  hourlyCap?: number;
  delayMinMs?: number;
  delayMaxMs?: number;
  messageFormat?: string | null;
  messageAssets?: MessageFormatConfig | null;
  shortLinksEnabled?: boolean | null;
  linkRotatorId?: string | null;
}

/** Raw `automations` row as returned by Supabase (snake_case). */
type AutomationRow = {
  id: string;
  workspace_id: string;
  name?: string | null;
  trigger_type?: string | null;
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
  collect_retry_message?: string | null;
  collect_skip_message?: string | null;
  collect_success_message?: string | null;
  collect_skip_keywords?: string[] | null;
  collect_max_attempts?: number | null;
  opening_message?: string | null;
  hourly_cap?: number | null;
  delay_min_ms?: number | null;
  delay_max_ms?: number | null;
  message_format?: string | null;
  message_assets?: unknown;
  short_links_enabled?: boolean | null;
  link_rotator_id?: string | null;
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
    // Preserve the real trigger type. Collapsing every non-share value to
    // "COMMENT" would let a future trigger family (DM_KEYWORD, STORY_REPLY,
    // …) slip through the comment dispatcher.
    triggerType: row.trigger_type ?? "COMMENT",
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
    collectRetryMessage: row.collect_retry_message ?? null,
    collectSkipMessage: row.collect_skip_message ?? null,
    collectSuccessMessage: row.collect_success_message ?? null,
    collectSkipKeywords: row.collect_skip_keywords ?? null,
    collectMaxAttempts: row.collect_max_attempts ?? null,
    openingMessage: row.opening_message,
    hourlyCap: row.hourly_cap ?? 0,
    delayMinMs: row.delay_min_ms ?? 0,
    delayMaxMs: row.delay_max_ms ?? 2000,
    messageFormat: row.message_format ?? "text",
    messageAssets:
      row.message_assets && typeof row.message_assets === "object" &&
      !Array.isArray(row.message_assets) && "format" in row.message_assets
        ? (row.message_assets as MessageFormatConfig)
        : null,
    shortLinksEnabled: row.short_links_enabled ?? false,
    linkRotatorId: row.link_rotator_id ?? null,
  };
}

type DmRule = DispatchRule & { workspace_id: string };

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

/** Returns true when the automation should run for this media item. */
export async function matchesPostScope(
  auto: { postScope?: string | null; postId?: string | null },
  event: { mediaId: string },
  token: string,
  _latestMediaCache?: Map<string, Promise<string | null>>
): Promise<boolean> {
  if (auto.postScope === "SPECIFIC_POST") {
    return Boolean(auto.postId && auto.postId === event.mediaId);
  }
  if (auto.postScope === "NEXT_POST") {
    // Caching and in-flight coalescing now live in the shared resolver. The
    // old per-event Map argument is kept only for backwards compatibility.
    const latest = await resolveLatestMedia(token, event.mediaId);
    // Keep the legacy per-request cache populated for callers that still
    // pass/inspect it; the real dedupe happens in the shared resolver.
    if (_latestMediaCache && token) {
      _latestMediaCache.set(token, Promise.resolve(latest.mediaId));
    }
    return Boolean(latest.mediaId && latest.mediaId === event.mediaId);
  }
  return true;
}

/**
 * Resolves every variable used in a template for one recipient.
 * All send paths go through here, so `{name}` and `{voucher}` behave the same
 * in a comment DM, an opt-in release, an inbox rule or an opening message.
 */
async function varsForTemplate(input: {
  workspaceId: string;
  template: string;
  scopeKey: string;
  recipientId: string;
  contactId?: string | null;
  username?: string | null;
  keyword?: string;
  link?: string | null;
  prefix?: string | null;
}): Promise<DmVars> {
  const { vars } = await resolveDmVars(input);
  return vars;
}

/**
 * Chooses a DM variant with cross-instance history so two consecutive sends
 * from the same automation never use the same copy. `previousIndex` is no
 * longer threaded through callers — the fingerprint history replaces it and
 * survives multiple serverless workers.
 */
async function chooseDmVariant(
  scopeKey: string,
  variants: string[] | null | undefined,
  primaryMessage: string
): Promise<{ choice: VariantChoice; recent: string[] }> {
  const recent = await getRecentVariantFingerprints(`dm:${scopeKey}`);
  const chosen =
    chooseVariant(normalizeDmVariants(variants, primaryMessage), recent) ?? {
      text: primaryMessage,
      index: -1,
      fingerprint: variantFingerprint(primaryMessage),
    };
  return { choice: chosen, recent };
}

async function recordDmVariant(
  scopeKey: string,
  choice: VariantChoice,
  recent: string[]
): Promise<void> {
  await recordVariantFingerprint(`dm:${scopeKey}`, choice.fingerprint, recent);
}

/** Keywords that permanently opt a person out of automated DMs. */
export const OPT_OUT_KEYWORDS = [
  "stop",
  "stop all",
  "unsubscribe",
  "cancel",
  "end",
  "opt out",
  "optout",
];

export function isOptOutMessage(text: string | null | undefined): boolean {
  const normalized = (text ?? "").toLowerCase().trim();
  if (!normalized) return false;
  return OPT_OUT_KEYWORDS.some((keyword) => {
    const clean = keyword.toLowerCase().trim();
    return normalized === clean || normalized.startsWith(`${clean} `) || normalized.endsWith(` ${clean}`);
  });
}

export async function isOptedOut(
  workspaceId: string,
  recipientId: string
): Promise<boolean> {
  if (!hasAdminDb()) return false;
  try {
    const { data } = await getAdminDb()
      .from("contacts")
      .select("opted_out_at")
      .eq("workspace_id", workspaceId)
      .eq("instagram_id", recipientId)
      .maybeSingle();
    return Boolean(data?.opted_out_at);
  } catch {
    // Fail closed: if the opt-out state cannot be read, do not message.
    return true;
  }
}

export async function recordOptOut(
  workspaceId: string,
  recipientId: string,
  keyword: string
): Promise<boolean> {
  if (!hasAdminDb()) return false;
  try {
    // Upsert, not update: a first-time story sender has no contacts row yet,
    // and an update-only write would silently drop the opt-out.
    const { error } = await getAdminDb()
      .from("contacts")
      .upsert(
        {
          workspace_id: workspaceId,
          instagram_id: recipientId,
          source: "opt_out",
          opted_out_at: nowIso(),
          opted_out_keyword: keyword,
          updated_at: nowIso(),
        },
        { onConflict: "workspace_id,instagram_id" }
      );
    if (error) throw error;
    await recordSafety({
      workspaceId,
      recipientId,
      kind: "opt_out",
    });
    return true;
  } catch (error) {
    console.warn("[opt-out] Could not record opt-out:", error);
    return false;
  }
}

/** Marks a sender+media as handled by a story trigger (5-min window). */
async function markStoryHandled(
  accountId: string,
  senderId: string,
  mediaId?: string | null
): Promise<void> {
  if (!hasUpstashRedis()) return;
  try {
    const key = mediaId
      ? `story:handled:${accountId}:${senderId}:${mediaId}`
      : `story:handled:${accountId}:${senderId}`;
    await getRedis().set(key, "1", { ex: 300 });
    // Also set a sender-only key for the inbound DM dedupe path, since
    // inbound DMs don't carry the story media id.
    await getRedis().set(`story:handled:${accountId}:${senderId}`, "1", { ex: 300 });
  } catch {
    // Dedupe is best-effort; never block a DM on Redis.
  }
}

/** True if this sender was recently handled by a story trigger. */
async function wasStoryHandled(
  accountId: string,
  senderId: string,
  mediaId?: string | null
): Promise<boolean> {
  if (!hasUpstashRedis()) return false;
  try {
    // Check the precise key first, then the sender-only fallback.
    if (mediaId) {
      const precise = await getRedis().get(`story:handled:${accountId}:${senderId}:${mediaId}`);
      if (precise) return true;
    }
    const value = await getRedis().get(`story:handled:${accountId}:${senderId}`);
    return Boolean(value);
  } catch {
    return false;
  }
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
      .select(
        "id, workspace_id, access_token, token_status, fallback_reply_enabled, fallback_reply_message, fallback_reply_variants, fallback_once_per_days, fallback_follow_gate_enabled, fallback_opening_message, fallback_follow_gate_button_label, fallback_follow_gate_on_unavailable, fallback_button_text, fallback_button_url, fallback_short_links_enabled, fallback_link_rotator_id"
      )
      .eq("instagram_id", instagramId)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data
      ? {
          id: data.id as string,
          workspace_id: data.workspace_id as string,
          access_token: (data.access_token as string | null) ?? null,
          token_status: (data.token_status as string | null) ?? null,
          fallback: data as FallbackRow,
        }
      : null;
  } catch {
    return null;
  }
}

async function getAccountToken(account: { access_token: string | null } | null): Promise<string | null> {
  if (account?.access_token) {
    try {
      return decryptToken(account.access_token);
    } catch (error) {
      console.warn("[webhook] Could not decrypt account token:", error);
    }
  }
  // Fail closed. A process-wide fallback token would break the binding between
  // the credential and the account it is used for.
  return null;
}

/**
 * Returns the account-bound token, or null. When the token is missing or
 * undecryptable, marks the account for reconnection once so the creator sees
 * it in Settings instead of silently losing automations.
 */
async function getToken(account: {
  id: string;
  workspace_id: string;
  access_token: string | null;
  token_status?: string | null;
} | null): Promise<string | null> {
  const token = await getAccountToken(account);
  if (!token && account && account.token_status !== "invalid") {
    await markTokenInvalid(
      account.id,
      account.workspace_id,
      "No stored or decryptable access token"
    );
  }
  return token;
}

export async function ensureContact(
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

/**
 * Applies a Meta read/delivery receipt to the conversation history and the
 * delivery log. Best-effort: a receipt must never break webhook processing.
 */
async function applyReceipt(input: {
  workspaceId: string;
  instagramAccountId: string;
  recipientId: string;
  kind: "delivered" | "read";
  at: string;
  mids?: string[];
}): Promise<void> {
  if (!hasAdminDb()) return;
  const db = getAdminDb();
  try {
    const { data: contact } = await db
      .from("contacts")
      .select("id")
      .eq("workspace_id", input.workspaceId)
      .eq("instagram_id", input.recipientId)
      .maybeSingle();

    if (contact?.id) {
      const { data: conversation } = await db
        .from("conversations")
        .select("id")
        .eq("contact_id", contact.id)
        .eq("instagram_account_id", input.instagramAccountId)
        .maybeSingle();

      if (conversation?.id) {
        const patch: Record<string, unknown> =
          input.kind === "read"
            ? { delivery_status: "read", read_at: input.at }
            : { delivery_status: "delivered", delivered_at: input.at };
        let query = db
          .from("messages")
          .update(patch)
          .eq("conversation_id", conversation.id)
          .eq("direction", "outbound");
        if (input.kind === "read") query = query.is("read_at", null);
        else query = query.is("delivered_at", null);
        if (input.mids && input.mids.length > 0) {
          query = query.in("external_id", input.mids);
        }
        await query;
      }
    }

    const logPatch: Record<string, unknown> =
      input.kind === "read" ? { read_at: input.at } : { delivered_at: input.at };
    let logQuery = db
      .from("dm_logs")
      .update(logPatch)
      .eq("workspace_id", input.workspaceId)
      .eq("instagram_account_id", input.instagramAccountId)
      .eq("recipient_id", input.recipientId)
      .eq("status", "SENT");
    if (input.kind === "read") logQuery = logQuery.is("read_at", null);
    else logQuery = logQuery.is("delivered_at", null);
    await logQuery;
  } catch (error) {
    console.warn(`[webhook] Could not apply ${input.kind} receipt:`, error);
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
      delay_min_ms: (rule as { delay_min_ms?: number | null }).delay_min_ms ?? 0,
      delay_max_ms: (rule as { delay_max_ms?: number | null }).delay_max_ms ?? 2000,
      hourly_cap: (rule as { hourly_cap?: number | null }).hourly_cap ?? 0,
      collect_retry_message:
        (rule as { collect_retry_message?: string | null }).collect_retry_message ?? null,
      collect_skip_message:
        (rule as { collect_skip_message?: string | null }).collect_skip_message ?? null,
      collect_success_message:
        (rule as { collect_success_message?: string | null }).collect_success_message ?? null,
      collect_skip_keywords:
        (rule as { collect_skip_keywords?: string[] | null }).collect_skip_keywords ?? null,
      collect_max_attempts:
        (rule as { collect_max_attempts?: number | null }).collect_max_attempts ?? null,
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
    // Fail closed: if we cannot confirm a recent send, treat the recipient as
    // already contacted rather than risk a duplicate DM.
    console.warn("[webhook] recentlyMessaged lookup failed; treating as recently contacted");
    return true;
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
          media_type: event.mediaType ?? null,
          media_product_type: event.mediaProductType ?? null,
        },
        { onConflict: "workspace_id,external_id", ignoreDuplicates: true }
      );
    if (error) throw error;
  } catch (error) {
    console.warn("[webhook] Could not persist comment event:", error);
  }
}

async function persistShareEvent(
  workspaceId: string,
  accountId: string | null,
  event: WebhookShareEvent
): Promise<void> {
  if (!hasAdminDb()) return;
  try {
    await getAdminDb()
      .from("share_events")
      .upsert(
        {
          workspace_id: workspaceId,
          instagram_account_id: accountId,
          external_id: event.messageId,
          sender_id: event.senderId,
          sender_username: event.senderName ?? null,
          media_id: event.mediaId ?? null,
          title: event.title ?? null,
          url: event.url ?? null,
        },
        { onConflict: "workspace_id,external_id", ignoreDuplicates: true }
      );
  } catch (error) {
    console.warn("[webhook] Could not persist share event:", error);
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
  collectConfig?: CollectConfig | null;
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
        collect_config: input.collectConfig ?? null,
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

/**
 * Atomically claims a pending row and returns it.
 *
 * The claim is a single `UPDATE … WHERE claimed_at IS NULL` so two concurrent
 * postbacks cannot both release the same opt-in. Callers that keep the row
 * (follow gate not yet satisfied, transient send failure) must call
 * `releasePendingClaim` so the follower can try again.
 */
export async function consumePending(
  id: string,
  scope?: {
    workspaceId?: string;
    recipientId?: string;
    kind?: string;
    instagramAccountId?: string;
  }
) {
  if (!hasAdminDb()) return null;
  try {
    let query = getAdminDb()
      .from("pending_dms")
      .update({ claimed_at: nowIso() })
      .eq("id", id)
      .is("claimed_at", null)
      .gt("expires_at", nowIso());
    if (scope?.workspaceId) query = query.eq("workspace_id", scope.workspaceId);
    if (scope?.recipientId) query = query.eq("recipient_id", scope.recipientId);
    if (scope?.kind) query = query.eq("kind", scope.kind);
    if (scope?.instagramAccountId) {
      query = query.eq("instagram_account_id", scope.instagramAccountId);
    }
    const { data, error } = await query
      .select(
        "id, workspace_id, kind, automation_id, rule_id, instagram_account_id, recipient_id, comment_id, message, button_text, button_url, collect_field"
      )
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

/** Releases a claim taken by `consumePending` so the row can be retried. */
async function releasePendingClaim(id: string): Promise<void> {
  if (!hasAdminDb()) return;
  try {
    await getAdminDb()
      .from("pending_dms")
      .update({ claimed_at: null })
      .eq("id", id);
  } catch {
    // Best effort: a stuck claim only blocks a retry until the row expires.
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

/** Saves a collected value on the contact (column or custom property). */
async function saveContactField(input: {
  workspaceId: string;
  recipientId: string;
  field: ReturnType<typeof parseCollectField>;
  value: string;
}): Promise<string | null> {
  if (!hasAdminDb() || !input.field) return null;
  const db = getAdminDb();
  try {
    const { data: contact } = await db
      .from("contacts")
      .select("id, properties")
      .eq("workspace_id", input.workspaceId)
      .eq("instagram_id", input.recipientId)
      .maybeSingle();
    if (!contact?.id) return null;

    const patch: Record<string, unknown> = {
      updated_at: nowIso(),
      last_interaction_at: nowIso(),
    };
    if (input.field.kind === "email") patch.email = input.value;
    else if (input.field.kind === "phone") patch.phone = input.value;
    else if (input.field.kind === "name") patch.display_name = input.value;
    else if (input.field.kind === "custom" && input.field.key) {
      const properties =
        contact.properties && typeof contact.properties === "object"
          ? { ...(contact.properties as Record<string, unknown>) }
          : {};
      properties[input.field.key] = input.value;
      patch.properties = properties;
    }

    await db.from("contacts").update(patch).eq("id", contact.id);
    return String(contact.id);
  } catch (error) {
    console.warn("[webhook] Could not save contact field:", error);
    return null;
  }
}

/** Appends a lead-capture event for analytics and audit. */
async function recordLeadEvent(input: {
  workspaceId: string;
  automationId?: string | null;
  ruleId?: string | null;
  contactId?: string | null;
  recipientId?: string | null;
  kind: "prompt" | "captured" | "skipped" | "invalid";
  field?: string | null;
  value?: string | null;
}): Promise<void> {
  if (!hasAdminDb()) return;
  try {
    await getAdminDb().from("lead_events").insert({
      workspace_id: input.workspaceId,
      automation_id: input.automationId ?? null,
      rule_id: input.ruleId ?? null,
      contact_id: input.contactId ?? null,
      recipient_id: input.recipientId ?? null,
      kind: input.kind,
      field: input.field ?? null,
      value: input.value ?? null,
    });
  } catch (error) {
    console.warn("[webhook] Could not record lead event:", error);
  }
}

interface PostbackRouteRow {
  id: string;
  workspace_id: string;
  automation_id: string | null;
  payload: string;
  action: "tag" | "branch" | "followup" | "optin";
  config: Record<string, unknown>;
  active: boolean;
}

async function loadPostbackRoute(
  workspaceId: string,
  payload: string
): Promise<PostbackRouteRow | null> {
  if (!hasAdminDb()) return null;
  try {
    const { data } = await getAdminDb()
      .from("postback_routes")
      .select("id, workspace_id, automation_id, payload, action, config, active")
      .eq("workspace_id", workspaceId)
      .eq("payload", payload)
      .eq("active", true)
      .maybeSingle();
    return (data as PostbackRouteRow | null) ?? null;
  } catch {
    return null;
  }
}

async function executePostbackRoute(input: {
  route: PostbackRouteRow;
  event: WebhookPostbackEvent;
  account: { id: string; workspace_id: string };
  token: string;
}): Promise<boolean> {
  const { route, event, account } = input;
  const db = hasAdminDb() ? getAdminDb() : null;

  // Tag action: add a tag to the contact.
  if (route.action === "tag") {
    const tag = String(route.config?.tag ?? "").trim();
    if (!tag || !db) return false;
    try {
      const { data: contact } = await db
        .from("contacts")
        .select("id, tags")
        .eq("workspace_id", account.workspace_id)
        .eq("instagram_id", event.userId)
        .maybeSingle();
      if (!contact) return false;
      const tags = Array.isArray(contact.tags) ? [...contact.tags] : [];
      if (!tags.includes(tag)) tags.push(tag);
      await db
        .from("contacts")
        .update({ tags, updated_at: nowIso() })
        .eq("id", contact.id);
      return true;
    } catch (error) {
      console.warn("[postback] Tag action failed:", error);
      return false;
    }
  }

  // Branch action: send a specific message.
  if (route.action === "branch") {
    const message = String(route.config?.message ?? "").trim();
    if (!message) return false;
    try {
      const result = await withRetry(() =>
        sendDirectMessage(input.token, event.instagramAccountId, event.userId, message)
      );
      return !result?.error;
    } catch {
      return false;
    }
  }

  // Followup action: schedule a follow-up step by creating a followup_step
  // row if one doesn't exist, or trigger an existing one.
  if (route.action === "followup") {
    const delayMinutes = Number(route.config?.delayMinutes ?? 1440);
    const message = String(route.config?.message ?? "").trim();
    if (!message || !db) return false;
    try {
      // Find an automation for this workspace to anchor the follow-up.
      const { data: automation } = await db
        .from("automations")
        .select("id")
        .eq("workspace_id", account.workspace_id)
        .eq("active", true)
        .limit(1)
        .maybeSingle();
      if (!automation) return false;
      await db.from("followup_steps").upsert(
        {
          workspace_id: account.workspace_id,
          automation_id: automation.id,
          step: Number(route.config?.step ?? 1),
          delay_minutes: delayMinutes,
          message,
          enabled: true,
          holdout_percent: 0,
        },
        { onConflict: "automation_id,step" }
      );
      return true;
    } catch (error) {
      console.warn("[postback] Followup action failed:", error);
      return false;
    }
  }

  return false;
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
    short_links_enabled: Boolean(row.short_links_enabled),
    link_rotator_id: (row.link_rotator_id as string | null) ?? null,
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
 * T1.11: skip the follow tap for people who already messaged the creator in
 * the last 24 hours. They are in an active conversation, so gating them adds
 * friction without protecting the account.
 */
async function hasRecentInboundMessage(
  workspaceId: string,
  recipientId: string,
  hours = 24
): Promise<boolean> {
  if (!hasAdminDb()) return false;
  try {
    const { data } = await getAdminDb()
      .from("contacts")
      .select("last_inbound_at")
      .eq("workspace_id", workspaceId)
      .eq("instagram_id", recipientId)
      .maybeSingle();
    return isRecentInbound(
      data?.last_inbound_at ? String(data.last_inbound_at) : null,
      hours
    );
  } catch {
    return false;
  }
}

/** Records that the contact sent an inbound message (used by the 24h skip). */
async function markInboundInteraction(
  workspaceId: string,
  recipientId: string
): Promise<void> {
  if (!hasAdminDb()) return;
  try {
    await getAdminDb()
      .from("contacts")
      .update({
        last_inbound_at: nowIso(),
        last_interaction_at: nowIso(),
        updated_at: nowIso(),
      })
      .eq("workspace_id", workspaceId)
      .eq("instagram_id", recipientId);
  } catch {
    // Best effort; the gate still works without it.
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
  verification: {
    status: string;
    method: string;
    reason?: string | null;
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

async function countFollowChecksForPending(
  pendingId: string,
  workspaceId: string
): Promise<number> {
  if (!hasAdminDb()) return 0;
  try {
    const { count, error } = await getAdminDb()
      .from("follow_checks")
      .select("id", { count: "exact", head: true })
      .eq("pending_id", pendingId)
      .eq("workspace_id", workspaceId);
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
 * Sends and records the opening DM.
 *
 * Everything that must happen when an opener goes out lives here: dispatch
 * (comment reply or direct message), token-error handling, safety ledger,
 * metrics, analytics, the inbox conversation and the DM log. Callers only
 * decide whether the gate should ask; they never re-implement these side
 * effects. This is why the dashboard can count *sent* openers instead of
 * outstanding opt-in records.
 */
async function sendOpeningDm(input: {
  workspaceId: string;
  accountDbId: string | null;
  accountId: string;
  token: string;
  recipientId: string;
  pendingId: string;
  template: OpeningDmTemplate;
  username?: string | null;
  keyword?: string | null;
  link?: string | null;
  commentId?: string | null;
  contactId?: string | null;
  mediaId?: string | null;
  automationId?: string | null;
  ruleId?: string | null;
  reason?: string | null;
}): Promise<{ sent: boolean; error?: MetaApiError }> {
  const vars = await varsForTemplate({
    workspaceId: input.workspaceId,
    template: input.template.openingMessage,
    scopeKey: input.automationId
      ? `auto:${input.automationId}`
      : input.ruleId
        ? `rule:${input.ruleId}`
        : `pending:${input.pendingId}`,
    recipientId: input.recipientId,
    contactId: input.contactId,
    username: input.username,
    keyword: input.keyword ?? undefined,
    link: input.link,
    prefix: input.automationId ?? input.ruleId ?? null,
  });
  const text = renderOpeningDm(input.template, vars);

  const dispatch = () =>
    input.commentId
      ? sendPrivateReplyWithButton(
          input.token,
          input.accountId,
          input.commentId!,
          text,
          input.template.buttonLabel,
          `OPTIN:${input.pendingId}`
        )
      : sendDirectMessageWithButton(
          input.token,
          input.accountId,
          input.recipientId,
          text,
          input.template.buttonLabel,
          `OPTIN:${input.pendingId}`
        );

  const result = await withRetry(dispatch, 2);
  const code = metaErrorCode(result?.error);
  if (code === 190) {
    await markTokenInvalid(
      input.accountDbId,
      input.workspaceId,
      "Meta error 190: invalid OAuth access token"
    );
    return { sent: false, error: result.error };
  }
  if (result?.error) return { sent: false, error: result.error };

  await recordSafety({
    workspaceId: input.workspaceId,
    instagramAccountId: input.accountDbId,
    recipientId: input.recipientId,
    kind: "follow_gate_opening",
  });
  await recordMetricEvent({
    kind: "dm_sent",
    creatorId: input.workspaceId,
    targetId: input.automationId ?? input.ruleId ?? input.pendingId,
    timeZone: await getWorkspaceTimeZone(input.workspaceId),
  });
  captureServerEvent({
    event: "follow_gate_opening_sent",
    properties: {
      automation_id: input.automationId ?? null,
      rule_id: input.ruleId ?? null,
      reason: input.reason ?? null,
    },
    anonymous: true,
  });

  if (hasAdminDb()) {
    const contactId =
      input.contactId ??
      (await ensureContact(
        input.workspaceId,
        input.recipientId,
        input.username,
        "optin"
      ));
    const conversationId = contactId
      ? await ensureConversation(input.workspaceId, input.accountDbId, contactId)
      : null;
    if (conversationId) {
      await recordMessage({
        workspaceId: input.workspaceId,
        conversationId,
        externalId: result.message_id ?? null,
        direction: "outbound",
        senderType: "bot",
        text,
        status: "sent",
      });
    }
    await getAdminDb().from("dm_logs").insert({
      workspace_id: input.workspaceId,
      instagram_account_id: input.accountDbId,
      automation_id: input.automationId ?? null,
      recipient_id: input.recipientId,
      recipient_username: input.username || "instagram_user",
      trigger_keyword: "OPENING",
      dm_message: text,
      status: "SENT",
      post_id: input.mediaId ?? null,
      keyword: "OPENING",
      sequence_step: 0,
      variant: "opening",
    });
  }

  return { sent: true };
}

/**
 * Shared gate used by comment automations and every rule trigger.
 *
 * Confirmed followers proceed immediately, confirmed non-followers receive an
 * opening DM with an opt-in button, and verification outages follow the
 * creator's explicit hold/deliver policy (never a silent fail-open).
 */
export async function applyFollowGate(input: {
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
  /** Passed through to the DM log / inbox record when the opener is sent. */
  contactId?: string | null;
  mediaId?: string | null;
}): Promise<FollowGateOutcome> {
  if (!input.config.enabled) return { proceed: true };

  // T1.11: skip the tap for people already in an active 24h conversation.
  if (await hasRecentInboundMessage(input.workspaceId, input.recipientId, 24)) {
    await recordFollowCheck({
      workspaceId: input.workspaceId,
      accountDbId: input.accountDbId,
      automationId: input.automationId,
      ruleId: input.ruleId,
      recipientId: input.recipientId,
      verification: {
        status: "skipped",
        method: "none",
        reason: "recent_inbound",
      },
    });
    await recordSafety({
      workspaceId: input.workspaceId,
      instagramAccountId: input.accountDbId,
      recipientId: input.recipientId,
      kind: "follow_gate_skip_recent",
    });
    return { proceed: true };
  }

  // Every new request checks Meta again, so an unfollow is caught immediately.
  const verification = await verifyFollowership(
    input.token,
    input.accountId,
    input.recipientId,
    input.username,
    { force: true }
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

  const outcome = await sendOpeningDm({
    workspaceId: input.workspaceId,
    accountDbId: input.accountDbId,
    accountId: input.accountId,
    token: input.token,
    recipientId: input.recipientId,
    pendingId,
    template: normalizeOpeningTemplate({
      openingMessage: input.config.openingMessage,
      buttonLabel: input.config.buttonLabel,
    }),
    username: input.username,
    keyword: input.keyword,
    // The opening DM is a "follow me" CTA; a setup-time sentinel must never be
    // shown as a link. The real permalink is attached when the opt-in is released.
    link: isAutoReelLink(input.buttonUrl) ? "" : input.buttonUrl,
    commentId: input.commentId ?? null,
    contactId: input.contactId ?? null,
    mediaId: input.mediaId ?? null,
    automationId: input.automationId ?? null,
    ruleId: input.ruleId ?? null,
    reason: verification.reason ?? verification.status,
  });

  if (!outcome.sent) {
    await deletePending(pendingId);
    const skipped =
      metaErrorCode(outcome.error) === 190
        ? "Token invalid — reconnect required"
        : "Could not send the opening DM";
    return { proceed: false, skipped, verification };
  }
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
}): Promise<{ sent: boolean; skipped?: string; error?: MetaApiError }> {
  const { choice: variant, recent: variantRecent } = await chooseDmVariant(
    `rule:${input.rule.id}`,
    input.rule.variants,
    input.message
  );
  const contactId = await ensureContact(input.workspaceId, input.recipientId, undefined, "optin");
  const content = await buildAutomationContent({
    auto: {
      id: input.rule.id,
      postScope: null,
      buttonUrl: input.rule.button_url,
      dmMessage: variant.text,
      shortLinksEnabled: input.rule.short_links_enabled ?? false,
      linkRotatorId: input.rule.link_rotator_id ?? null,
    },
    token: input.token,
    accountId: input.accountId,
    mediaId: null,
    keyword: input.rule.keywords?.[0] ?? "",
    username: (await contactUsername(input.workspaceId, input.recipientId)) ?? undefined,
    workspaceId: input.workspaceId,
    contactId,
    recipientId: input.recipientId,
  });
  const text = content.text;

  const claimed = await claimDmSend({
    workspaceId: input.workspaceId,
    automationId: input.rule.id,
    instagramAccountId: input.accountDbId,
    recipientId: input.recipientId,
  });
  if (!claimed) {
    return { sent: false, skipped: "Send already in progress" };
  }

  const result = await withRetry(
    () =>
      input.rule.button_text && content.buttonUrl
        ? sendDirectMessage(
            input.token,
            input.accountId,
            input.recipientId,
            `${text}\n\n${input.rule.button_text}: ${content.buttonUrl}`
          )
        : sendDirectMessage(input.token, input.accountId, input.recipientId, text),
    3
  );
  const sent = !result?.error;

  if (!sent && !isTransientMetaError(result.error)) {
    await releaseDmSend({
      automationId: input.rule.id,
      recipientId: input.recipientId,
    });
  }

  if (sent) {
    await recordDmVariant(`rule:${input.rule.id}`, variant, variantRecent);
    await recordMetricEvent({
      kind: "dm_sent",
      creatorId: input.workspaceId,
      targetId: input.rule.id,
      timeZone: await getWorkspaceTimeZone(input.workspaceId),
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
      variant: variant.index >= 0 ? `variant-${variant.index + 1}` : "default",
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
  // `pending.message` is the *deliverable* (the guide DM), not the opener copy.
  // Never use it as the opening message: use the shared defaults instead.
  let config = normalizeFollowGateConfig({ enabled: true, onUnavailable: "hold" });
  let rule: DmRule | null = null;

  if (pending.rule_id && hasAdminDb()) {
    const { data } = await getAdminDb()
      .from("dm_rules")
      .select("*")
      .eq("id", pending.rule_id)
      .eq("workspace_id", pending.workspace_id)
      .maybeSingle();
    if (data) {
      rule = toDmRule(data as Partial<DmRule> & Record<string, unknown>);
      config = normalizeFollowGateConfig({
        enabled: true,
        openingMessage: rule.opening_message ?? null,
        buttonLabel: rule.follow_gate_button_label ?? pending.button_text,
        onUnavailable: rule.follow_gate_on_unavailable ?? "hold",
      });
    }
  } else if (pending.automation_id && hasAdminDb()) {
    const { data } = await getAdminDb()
      .from("automations")
      .select("opening_message, follow_gate_button_label, follow_gate_on_unavailable")
      .eq("id", pending.automation_id)
      .eq("workspace_id", pending.workspace_id)
      .maybeSingle();
    if (data) {
      config = normalizeFollowGateConfig({
        enabled: true,
        openingMessage: (data.opening_message as string | null) ?? null,
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
}): Promise<{ sent: boolean; skipped?: string; error?: MetaApiError }> {
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
      .eq("workspace_id", pending.workspace_id)
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
  const vars = await varsForTemplate({
    workspaceId: pending.workspace_id,
    template: pending.message ?? "",
    scopeKey: `pending:${pending.id}`,
    recipientId: input.userId,
    username: username ?? undefined,
    keyword: "OPTIN",
    link: isAutoReelLink(pending.button_url) ? "" : pending.button_url ?? "",
  });
  const text = formatDmText(pending.message ?? "", vars);
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
      timeZone: await getWorkspaceTimeZone(pending.workspace_id),
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
  pendingId: string,
  workspaceId: string
): Promise<FollowPromptRow | null> {
  if (!hasAdminDb()) return null;
  try {
    const { data, error } = await getAdminDb()
      .from("follow_prompts")
      .select("*")
      .eq("pending_id", pendingId)
      .eq("workspace_id", workspaceId)
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
  workspaceId: string,
  patch: Partial<Pick<FollowPromptRow, "status" | "tapped_at" | "resolved_at" | "delivered_at">>
): Promise<void> {
  if (!hasAdminDb()) return;
  try {
    await getAdminDb()
      .from("follow_prompts")
      .update(patch)
      .eq("id", id)
      .eq("workspace_id", workspaceId);
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
    const checks = await countFollowChecksForPending(pending.id, prompt.workspace_id);
    const expired = checks >= FOLLOW_GATE_LIMITS.maxChecksPerPending;
    await updateFollowPrompt(prompt.id, prompt.workspace_id, {
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
  await updateFollowPrompt(prompt.id, prompt.workspace_id, {
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
    await updateFollowPrompt(prompt.id, prompt.workspace_id, { delivered_at: nowIso() });
    await deletePending(pending.id);
  }
  return outcome;
}

// ── Dispatch helpers ─────────────────────────────────────────────────────────

/**
 * Posts a public reply and records the outcome.
 *
 * The Graph result is no longer discarded: every attempt lands in
 * `public_replies` with status and error detail, so failures are countable and
 * visible in diagnostics instead of silently disappearing.
 */
async function sendPublicReply(input: {
  workspaceId: string;
  accountDbId: string | null;
  automationId: string;
  token: string;
  commentId: string;
  recipientId: string;
  username?: string;
  keyword?: string;
  link?: string;
  variants: string[];
}): Promise<{ sent: boolean; error?: MetaApiError }> {
  const variants = normalizePublicReplies(input.variants);
  const recent = await getRecentPublicReplyFingerprints(input.automationId);
  const chosen = choosePublicReply(variants, recent);
  const message = renderPublicReply(chosen.message, {
    username: input.username,
    keyword: input.keyword,
    link: input.link,
  });

  const result = await withRetry(
    () => postPublicCommentReply(input.token, input.commentId, message),
    2
  );
  const sent = !result?.error;
  const code = metaErrorCode(result?.error);
  const detail = result?.error
    ? describeMetaError(result.error).slice(0, 500)
    : null;

  if (hasAdminDb()) {
    await getAdminDb().from("public_replies").insert({
      workspace_id: input.workspaceId,
      automation_id: input.automationId,
      instagram_account_id: input.accountDbId,
      comment_id: input.commentId,
      recipient_id: input.recipientId,
      message,
      status: sent ? "sent" : "failed",
      error_code: code ?? null,
      error_message: detail,
    });
  }

  // Only used variants enter the history, so a rejected reply is not burned.
  if (sent) {
    await recordPublicReplyFingerprint(
      input.automationId,
      chosen.fingerprint,
      recent
    );
  }

  // Public replies are counted from the `public_replies` ledger, not the DM
  // metric kind — adding a kind here would inflate "DMs sent" dashboards.
  captureServerEvent({
    event: sent ? "public_reply_sent" : "public_reply_failed",
    properties: {
      automation_id: input.automationId,
      error_code: code ?? null,
      variant_count: variants.length,
      variant_index: chosen.index,
    },
    anonymous: true,
  });
  if (!sent) {
    console.warn(`[public-reply] Failed for comment ${input.commentId}: ${detail}`);
  }

  return { sent, error: result?.error };
}

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
}): Promise<{ sent: boolean; skipped?: string; error?: MetaApiError }> {
  const { auto } = input;

  // Account-level ceiling: Meta allows 750 private replies/hour per Instagram
  // account. Enforce a shared ceiling across every automation so multiple
  // campaigns cannot collectively exceed it.
  const accountSlot = await acquireSendSlot(
    `${input.accountId}:account`,
    ACCOUNT_HOURLY_CEILING
  );
  if (!accountSlot.allowed) {
    await enqueueQueuedDm({
      workspaceId: input.workspaceId,
      automationId: auto.id,
      instagramAccountId: input.accountDbId,
      recipientId: input.recipientId,
      commentId: input.commentId,
      message: auto.dmMessage,
      buttonText: auto.buttonText,
      buttonUrl: auto.buttonUrl,
    });
    await recordSafety({
      workspaceId: input.workspaceId,
      instagramAccountId: input.accountDbId,
      recipientId: input.recipientId,
      kind: "rate_limit_breach",
    });
    console.warn(
      `[safety] Account ceiling (${ACCOUNT_HOURLY_CEILING}/h) reached; message queued`
    );
    return { sent: false };
  }

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

    await enqueueQueuedDm({
      workspaceId: input.workspaceId,
      automationId: auto.id,
      instagramAccountId: input.accountDbId,
      recipientId: input.recipientId,
      commentId: input.commentId,
      message: auto.dmMessage,
      buttonText: auto.buttonText,
      buttonUrl: auto.buttonUrl,
    });
    await recordSafety({
      workspaceId: input.workspaceId,
      instagramAccountId: input.accountDbId,
      recipientId: input.recipientId,
      kind: "rate_limit_breach",
    });
    console.warn(`[safety] Hourly cap reached for ${auto.name}; message parked (retry in ${limit.retryAfterMs}ms)`);
    return { sent: false };
  }

  // Proactive viral-spike throttle: shape delivery before Meta's own limits.
  const throttle = await acquireThrottleSlot(input.accountId);
  if (!throttle.allowed) {
    await recordSafety({
      workspaceId: input.workspaceId,
      instagramAccountId: input.accountDbId,
      recipientId: input.recipientId,
      kind: "viral_throttle",
    });
    await recordSendOutcome({
      accountId: input.accountDbId ?? input.accountId,
      outcome: "throttled",
      error: "Viral spike throttle",
    });
    await enqueueQueuedDm({
      workspaceId: input.workspaceId,
      automationId: auto.id,
      instagramAccountId: input.accountDbId,
      recipientId: input.recipientId,
      commentId: input.commentId,
      message: auto.dmMessage,
      buttonText: auto.buttonText,
      buttonUrl: auto.buttonUrl,
    });
    return { sent: false };
  }
  if (throttle.delayMs > 0) {
    await jitter(throttle.delayMs, throttle.delayMs);
  }

  // Configurable randomized pre-send delay (safety). Spreads bursts against
  // Meta's per-account rate limits. Defaults to 0-2s; creators can raise it.
  const delayMin = auto.delayMinMs ?? 0;
  const delayMax = auto.delayMaxMs ?? 0;
  if (delayMax > 0) {
    await jitter(delayMin, delayMax);
  }

  const { choice: variant, recent: variantRecent } = await chooseDmVariant(
    `auto:${auto.id}`,
    auto.dmVariants,
    auto.dmMessage
  );
  const content = await buildAutomationContent({
    auto: {
      id: auto.id,
      postScope: auto.postScope,
      buttonUrl: auto.buttonUrl,
      dmMessage: variant.text,
      messageFormat: auto.messageFormat,
      messageAssets: auto.messageAssets,
    },
    token: input.token,
    accountId: input.accountId,
    mediaId: input.event?.mediaId ?? null,
    keyword: input.keyword,
    username: input.username,
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    recipientId: input.recipientId,
    voucherPrefix: auto.name,
    shortLinksEnabled: auto.shortLinksEnabled ?? false,
    linkRotatorId: auto.linkRotatorId,
    sequenceStep: 1,
  });
  const { text, vars } = content;

  if (content.linkSource === "auto" || content.linkSource === "unavailable") {
    captureServerEvent({
      event: "reel_link_resolved",
      properties: {
        result: content.linkSource,
        automation_id: auto.id,
        media_id: input.event?.mediaId ?? null,
      },
      anonymous: true,
    });
  }

  await jitter(50, 350);

  const dispatch = () => {
    if (content.formatted.attachment) {
      return sendPrivateReplyWithAttachment(
        input.token,
        input.accountId,
        input.commentId,
        content.formatted
      );
    }
    return auto.buttonText && content.buttonUrl
      ? sendPrivateReplyWithButton(
          input.token,
          input.accountId,
          input.commentId,
          text,
          personalizeMessage(auto.buttonText, vars),
          content.buttonUrl
        )
      : sendPrivateReply(input.token, input.accountId, input.commentId, text);
  };

  // Atomic send claim: two overlapping deliveries cannot both pass the
  // read-before-send 24h guard. The first writer wins; the second skips.
  const claimed = await claimDmSend({
    workspaceId: input.workspaceId,
    automationId: auto.id,
    instagramAccountId: input.accountDbId,
    recipientId: input.recipientId,
  });
  if (!claimed) {
    return { sent: false, skipped: "Send already in progress" };
  }

  const result = await withRetry(dispatch, 3);
  const succeeded = !result?.error;

  // A definitive Meta rejection will never succeed on retry, so release the
  // claim. A transient/network error keeps it for the TTL: the request may
  // have reached Meta, and a duplicate private reply is worse than a delay.
  if (!succeeded && !isTransientMetaError(result.error)) {
    await releaseDmSend({
      automationId: auto.id,
      recipientId: input.recipientId,
    });
  }

  await recordSendOutcome({
    accountId: input.accountDbId ?? input.accountId,
    outcome: succeeded ? "sent" : "failed",
    error: succeeded ? null : describeMetaError(result.error),
  });

  if (succeeded) {
    await recordDmVariant(`auto:${auto.id}`, variant, variantRecent);
    await markReplied(input.accountId, input.event?.mediaId ?? "", input.recipientId, 30);
    await recordSafety({
      workspaceId: input.workspaceId,
      instagramAccountId: input.accountDbId,
      recipientId: input.recipientId,
    });
    await recordMetricEvent({
      kind: "dm_sent",
      creatorId: input.workspaceId,
      targetId: auto.id,
      timeZone: await getWorkspaceTimeZone(input.workspaceId),
    });

    if (auto.publicReplyEnabled) {
      await sendPublicReply({
        workspaceId: input.workspaceId,
        accountDbId: input.accountDbId,
        automationId: auto.id,
        token: input.token,
        commentId: input.commentId,
        recipientId: input.recipientId,
        username: input.username,
        keyword: input.keyword,
        link: vars.link,
        variants: auto.publicReplyMessages ?? [],
      });
    }

    if (input.contactId && auto.collectField) {
      const field = parseCollectField(auto.collectField);
      if (field) {
        const config = normalizeCollectConfig({
          retryMessage: auto.collectRetryMessage,
          skipMessage: auto.collectSkipMessage,
          successMessage: auto.collectSuccessMessage,
          skipKeywords: auto.collectSkipKeywords,
          maxAttempts: auto.collectMaxAttempts,
        });
        await createPending({
          workspaceId: input.workspaceId,
          kind: "collect",
          automationId: auto.id,
          instagramAccountId: input.accountDbId,
          recipientId: input.recipientId,
          message: renderCollectPrompt(field, config),
          collectField: auto.collectField,
          collectConfig: config,
        });
        await recordLeadEvent({
          workspaceId: input.workspaceId,
          automationId: auto.id,
          contactId: input.contactId,
          recipientId: input.recipientId,
          kind: "prompt",
          field: auto.collectField,
        });
      }
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
    variant: variant.index >= 0 ? `variant-${variant.index + 1}` : "default",
    message_format: content.formatted.format,
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
  // Defense in depth: only a COMMENT campaign may be dispatched from a comment
  // event. This is an allow-list, not a deny-list, so a future trigger family
  // cannot slip through the comment path.
  if (auto.triggerType !== "COMMENT") {
    return {
      sent: false,
      skipped: "Only comment campaigns can be dispatched from a comment event",
    };
  }
  if (!hasAdminDb()) return { sent: false, skipped: "Database unavailable" };

  const account = await getAccount(event.instagramAccountId);
  if (!account) return { sent: false, skipped: "Account not connected" };
  // The account row is the authoritative tenant binding. A campaign row that
  // points at another workspace must never be dispatched through this account.
  if (auto.workspaceId !== account.workspace_id) {
    return { sent: false, skipped: "Campaign workspace mismatch" };
  }
  const workspaceId = account.workspace_id;
  const token = await getToken(account);
  if (!token) return { sent: false, skipped: "No valid access token" };

  const latestMediaCache = new Map<string, Promise<string | null>>();
  const matchedKeyword = findMatchingKeyword(auto.triggerKeywords, event.commentText);
  if (matchedKeyword === null) return { sent: false, skipped: "No keyword match" };

  if (await isOptedOut(workspaceId, event.commenterId)) {
    return { sent: false, skipped: "Recipient opted out of automated DMs" };
  }
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

  // Reply-once-per-person-per-post (30-day memory). Prevents the same person
  // getting the same DM twice for the same post even across retries.
  const alreadyReplied = await hasRepliedRecently(
    event.instagramAccountId,
    event.mediaId,
    event.commenterId
  );
  if (alreadyReplied) return { sent: false, skipped: "Already replied to this person for this post (30-day)" };

  const contactId = await ensureContact(
    workspaceId,
    event.commenterId,
    event.commenterName,
    "comment"
  );

  if (auto.followGateEnabled) {
    const gate = await applyFollowGate({
      workspaceId,
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
      contactId,
      mediaId: event.mediaId,
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
    workspaceId,
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
  if (dispatch.skipped) {
    return { sent: false, skipped: dispatch.skipped, error: dispatch.error };
  }

  const code = metaErrorCode(dispatch.error);
  if (code === 190) {
    await markTokenInvalid(
      account.id,
      workspaceId,
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

/**
 * T1.9: Share-to-DM campaign trigger.
 *
 * A follower shares a reel/post into the creator's DM. We send the campaign's
 * thank-you DM once per share, with the same safety guards as a comment send.
 */
export async function processShareEventForAutomation(
  event: WebhookShareEvent,
  auto: AutomationLike
): Promise<{ sent: boolean; skipped?: string; error?: MetaApiError }> {
  if (!hasAdminDb()) return { sent: false, skipped: "Database unavailable" };

  const account = await getAccount(event.instagramAccountId);
  if (!account) return { sent: false, skipped: "Account not connected" };
  const token = await getToken(account);
  if (!token) return { sent: false, skipped: "No valid access token" };

  if (await isOptedOut(auto.workspaceId, event.senderId)) {
    return { sent: false, skipped: "Recipient opted out of automated DMs" };
  }

  // Once per share event. Meta can retry a webhook; the message id is stable.
  const shareKey = `share:handled:${event.instagramAccountId}:${event.messageId}`;
  if (hasUpstashRedis()) {
    try {
      if (await getRedis().get(shareKey)) {
        return { sent: false, skipped: "Share already handled" };
      }
    } catch {
      // Dedupe is best-effort; the DB guards below still apply.
    }
  }

  // Once per person per campaign per 24h.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: existing } = await getAdminDb()
    .from("dm_logs")
    .select("id")
    .eq("automation_id", auto.id)
    .eq("recipient_id", event.senderId)
    .eq("status", "SENT")
    .gte("sent_at", dayAgo)
    .limit(1)
    .maybeSingle();
  if (existing) return { sent: false, skipped: "Already messaged in 24h" };

  const cooldownOk = await checkRecipientCooldown(
    event.instagramAccountId,
    event.mediaId ?? "",
    event.senderId
  );
  if (!cooldownOk) return { sent: false, skipped: "Recipient cooldown" };

  const alreadyReplied = await hasRepliedRecently(
    event.instagramAccountId,
    event.mediaId ?? "",
    event.senderId
  );
  if (alreadyReplied) {
    return { sent: false, skipped: "Already replied to this person for this share" };
  }

  const contactId = await ensureContact(
    auto.workspaceId,
    event.senderId,
    event.senderName,
    "share"
  );
  const conversationId = contactId
    ? await ensureConversation(auto.workspaceId, account.id, contactId)
    : null;

  // Safety: hourly cap + viral throttle + randomized delay.
  const cap = auto.hourlyCap ?? 0;
  if (cap > 0) {
    const slot = await acquireSendSlot(`${event.instagramAccountId}:${auto.id}`, cap);
    if (!slot.allowed) return { sent: false, skipped: "Hourly cap reached" };
  }
  const throttle = await acquireThrottleSlot(event.instagramAccountId);
  if (!throttle.allowed) return { sent: false, skipped: "Viral throttle" };
  if (throttle.delayMs > 0) await jitter(throttle.delayMs, throttle.delayMs);
  const delayMin = auto.delayMinMs ?? 0;
  const delayMax = auto.delayMaxMs ?? 0;
  if (delayMax > 0) await jitter(delayMin, delayMax);

  const { choice: variant, recent: variantRecent } = await chooseDmVariant(
    `auto:${auto.id}`,
    auto.dmVariants,
    auto.dmMessage
  );

  const content = await buildAutomationContent({
    auto: {
      id: auto.id,
      postScope: auto.postScope,
      buttonUrl: auto.buttonUrl,
      dmMessage: variant.text,
      messageFormat: auto.messageFormat,
      messageAssets: auto.messageAssets,
    },
    token,
    accountId: event.instagramAccountId,
    mediaId: event.mediaId ?? null,
    keyword: "SHARE",
    username: event.senderName,
    workspaceId: auto.workspaceId,
    contactId,
    recipientId: event.senderId,
    voucherPrefix: auto.name,
    shortLinksEnabled: auto.shortLinksEnabled ?? false,
    linkRotatorId: auto.linkRotatorId,
    sequenceStep: 1,
  });

  const text = content.text;
  const result = await withRetry(() =>
    auto.buttonText && content.buttonUrl
      ? sendDirectMessageWithButton(
          token,
          event.instagramAccountId,
          event.senderId,
          text,
          auto.buttonText,
          content.buttonUrl
        )
      : sendDirectMessage(token, event.instagramAccountId, event.senderId, text)
  );
  const succeeded = !result?.error;

  if (succeeded) {
    if (hasUpstashRedis()) {
      try {
        await getRedis().set(shareKey, "1", { ex: 60 * 60 * 24 * 30 });
      } catch {
        // Best effort.
      }
    }
    await recordDmVariant(`auto:${auto.id}`, variant, variantRecent);
    await markReplied(
      event.instagramAccountId,
      event.mediaId ?? "",
      event.senderId,
      30
    );
    await recordMetricEvent({
      kind: "dm_sent",
      creatorId: auto.workspaceId,
      targetId: auto.id,
      timeZone: await getWorkspaceTimeZone(auto.workspaceId),
    });
  }

  await recordSafety({
    workspaceId: auto.workspaceId,
    instagramAccountId: account.id,
    recipientId: event.senderId,
    kind: "share",
  });

  if (conversationId) {
    await recordMessage({
      workspaceId: auto.workspaceId,
      conversationId,
      externalId: result?.message_id ?? null,
      direction: "outbound",
      senderType: "bot",
      text,
      status: succeeded ? "sent" : "failed",
    });
  }

  await getAdminDb().from("dm_logs").insert({
    workspace_id: auto.workspaceId,
    instagram_account_id: account.id,
    automation_id: auto.id,
    recipient_id: event.senderId,
    recipient_username: event.senderName || "instagram_user",
    trigger_keyword: "SHARE",
    dm_message: text,
    status: succeeded ? "SENT" : "FAILED",
    post_id: event.mediaId ?? null,
    keyword: "SHARE",
    sequence_step: 1,
    variant: variant.index >= 0 ? `variant-${variant.index + 1}` : "default",
    message_format: content.formatted.format,
  });

  return { sent: succeeded, error: result?.error };
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

  // Opt-out handling takes priority over every rule, including keyword rules.
  if (isOptOutMessage(input.matchedText)) {
    const recorded = await recordOptOut(
      input.workspaceId,
      input.recipientId,
      String(input.matchedText ?? "")
    );
    if (!recorded) {
      // Never tell someone they are unsubscribed unless the opt-out is
      // durably stored. The next "stop" will retry the write.
      console.error("[opt-out] Opt-out could not be persisted; skipping confirmation", {
        workspaceId: input.workspaceId,
        recipientId: input.recipientId,
      });
      return false;
    }
    await withRetry(() =>
      sendDirectMessage(
        input.token,
        input.accountId,
        input.recipientId,
        "You've been unsubscribed from automated messages. Reply START anytime to re-subscribe."
      )
    );
    return false;
  }

  if (await isOptedOut(input.workspaceId, input.recipientId)) {
    return false;
  }
  if (await recentlyMessaged(input.workspaceId, input.recipientId, rule.id, rule.once_per_days)) {
    return false;
  }

  // Safety: hourly cap + viral throttle + randomized delay for inbox/story/share rules.
  const cap = (rule.hourly_cap ?? 0) || 0;
  if (cap > 0) {
    const slot = await acquireSendSlot(`${input.accountId}:${rule.id}`, cap);
    if (!slot.allowed) {
      return false;
    }
  }
  const throttle = await acquireThrottleSlot(input.accountId);
  if (!throttle.allowed) {
    return false;
  }
  if (throttle.delayMs > 0) await jitter(throttle.delayMs, throttle.delayMs);
  const dMin = rule.delay_min_ms ?? 0;
  const dMax = rule.delay_max_ms ?? 0;
  if (dMax > 0) await jitter(dMin, dMax);

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
      contactId,
    });
    if (!gate.proceed) return false;
  }

  const conversationId = contactId
    ? await ensureConversation(input.workspaceId, input.accountDbId, contactId)
    : null;

  const { choice: variant, recent: variantRecent } = await chooseDmVariant(
    `rule:${rule.id}`,
    rule.variants,
    rule.message
  );
  const content = await buildAutomationContent({
    auto: {
      id: rule.id,
      postScope: null,
      buttonUrl: rule.button_url,
      dmMessage: variant.text,
      shortLinksEnabled: rule.short_links_enabled ?? false,
      linkRotatorId: rule.link_rotator_id ?? null,
    },
    token: input.token,
    accountId: input.accountId,
    mediaId: null,
    keyword: input.matchedText ?? "",
    username: input.username,
    workspaceId: input.workspaceId,
    contactId,
    recipientId: input.recipientId,
  });
  const text = content.text;

  await jitter(50, 350);
  // Always send the real destination URL in DM text. Long signed /go/ links
  // are not rendered as clickable links by Instagram.
  const result = await withRetry(() =>
    rule.button_text && content.buttonUrl
      ? sendDirectMessage(
          input.token,
          input.accountId,
          input.recipientId,
          `${text}\n\n${rule.button_text}: ${content.buttonUrl}`
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
    await recordDmVariant(`rule:${rule.id}`, variant, variantRecent);
    await recordMetricEvent({
      kind: "dm_sent",
      creatorId: input.workspaceId,
      targetId: rule.id,
      timeZone: await getWorkspaceTimeZone(input.workspaceId),
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
      variant: variant.index >= 0 ? `variant-${variant.index + 1}` : "default",
    });
  }

  if (succeeded && rule.collect_field && contactId) {
    const field = parseCollectField(rule.collect_field);
    if (field) {
      const config = normalizeCollectConfig({
        retryMessage: rule.collect_retry_message,
        skipMessage: rule.collect_skip_message,
        successMessage: rule.collect_success_message,
        skipKeywords: rule.collect_skip_keywords,
        maxAttempts: rule.collect_max_attempts,
      });
      await createPending({
        workspaceId: input.workspaceId,
        kind: "collect",
        ruleId: rule.id,
        instagramAccountId: input.accountDbId,
        recipientId: input.recipientId,
        message: renderCollectPrompt(field, config),
        collectField: rule.collect_field,
        collectConfig: config,
      });
      await recordLeadEvent({
        workspaceId: input.workspaceId,
        ruleId: rule.id,
        contactId,
        recipientId: input.recipientId,
        kind: "prompt",
        field: rule.collect_field,
      });
    }
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
}): Promise<{ sent: boolean; skipped?: string; error?: MetaApiError }> {
  const { choice: variant, recent: variantRecent } = await chooseDmVariant(
    `auto:${input.auto.id}`,
    input.auto.dmVariants,
    input.auto.dmMessage ?? ""
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

  const content = await buildAutomationContent({
    auto: {
      id: input.auto.id,
      postScope: input.auto.postScope,
      buttonUrl: input.auto.buttonUrl,
      dmMessage: variant.text,
      messageFormat: input.auto.messageFormat,
      messageAssets: input.auto.messageAssets,
    },
    token: input.token,
    accountId: input.accountId,
    mediaId: input.postId,
    keyword: input.keyword ?? "OPTIN",
    username,
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    recipientId: input.recipientId,
    voucherPrefix: input.auto.name,
    shortLinksEnabled: input.auto.shortLinksEnabled ?? false,
    linkRotatorId: input.auto.linkRotatorId,
    sequenceStep: 2,
  });
  const text = content.text;

  const claimed = await claimDmSend({
    workspaceId: input.workspaceId,
    automationId: input.auto.id,
    instagramAccountId: input.accountDbId,
    recipientId: input.recipientId,
  });
  if (!claimed) {
    return { sent: false, skipped: "Send already in progress" };
  }

  const response = await withRetry(
    () =>
      content.formatted.attachment
        ? sendDirectMessageWithAttachment(
            input.token,
            input.accountId,
            input.recipientId,
            content.formatted
          )
        : sendDirectMessage(input.token, input.accountId, input.recipientId, text),
    3
  );
  const sent = !response?.error;

  if (!sent && !isTransientMetaError(response.error)) {
    await releaseDmSend({
      automationId: input.auto.id,
      recipientId: input.recipientId,
    });
  }

  if (sent) {
    await recordDmVariant(`auto:${input.auto.id}`, variant, variantRecent);
    await recordMetricEvent({
      kind: "dm_sent",
      creatorId: input.workspaceId,
      targetId: input.auto.id,
      timeZone: await getWorkspaceTimeZone(input.workspaceId),
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
      variant: variant.index >= 0 ? `variant-${variant.index + 1}` : "default",
      message_format: content.formatted.format,
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
      // Skip comment-thread replies: only top-level comments trigger automations.
      // Meta sets parent_id on replies to a comment.
      if (event.parentCommentId) {
        result.events.push({ kind: "comment", accountId: event.instagramAccountId, outcome: "skipped", detail: "Comment thread reply (skipped)" });
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
      // Count this event once in the 60-second velocity window. The 5-minute
      // count is only used for spike detection, not for the bucket itself.
      await recordCommentVelocity(event.instagramAccountId, 1);
      if (isViralSpike(recentCount ?? 0)) {
        console.warn("[safety] Viral spike detected — throttling delivery");
        await recordSafety({
          workspaceId: account.workspace_id,
          instagramAccountId: account.id,
          recipientId: event.commenterId,
          kind: "viral_spike",
        });
        await jitter(500, 2000);
      }

      const { data: automationRows } = await getAdminDb()
        .from("automations")
        .select("*")
        .eq("workspace_id", account.workspace_id)
        .eq("trigger_type", "COMMENT")
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
      const token = await getToken(account);
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
      await markInboundInteraction(account.workspace_id, event.senderId);
      await recordMetricEvent({
        kind: "dm_reply",
        creatorId: account.workspace_id,
        targetId: account.id,
        timeZone: await getWorkspaceTimeZone(account.workspace_id),
      });

      // Human takeover is authoritative: no automation replies while an agent
      // has paused the bot on this conversation.
      if (conversationId) {
        const { data: conversation } = await getAdminDb()
          .from("conversations")
          .select("is_bot_active")
          .eq("id", conversationId)
          .maybeSingle();
        if (conversation && conversation.is_bot_active === false) continue;
      }

      // Opt-out handling takes priority over every rule.
      if (isOptOutMessage(event.messageText)) {
        await recordOptOut(account.workspace_id, event.senderId, event.messageText ?? "");
        if (!token) continue;
        await withRetry(() =>
          sendDirectMessage(
            token,
            event.instagramAccountId,
            event.senderId,
            "You've been unsubscribed from automated messages. Reply START anytime to re-subscribe."
          )
        );
        continue;
      }
      if (await isOptedOut(account.workspace_id, event.senderId)) {
        if (!token) continue;
        const normalized = (event.messageText ?? "").toLowerCase().trim();
        if (normalized === "start" || normalized === "subscribe" || normalized === "yes") {
          if (hasAdminDb()) {
            await getAdminDb()
              .from("contacts")
              .update({ opted_out_at: null, updated_at: nowIso() })
              .eq("workspace_id", account.workspace_id)
              .eq("instagram_id", event.senderId);
          }
          await withRetry(() =>
            sendDirectMessage(
              token,
              event.instagramAccountId,
              event.senderId,
              "You're re-subscribed. We'll be in touch again."
            )
          );
        }
        continue;
      }

      // If this sender was just handled by a story trigger, do not also run
      // keyword rules — that is the double-fire the audit calls out. The
      // inbound message is already recorded above for the inbox.
      if (await wasStoryHandled(event.instagramAccountId, event.senderId)) {
        result.events.push({
          kind: "message",
          accountId: event.instagramAccountId,
          outcome: "skipped",
          detail: "Already handled by a story trigger",
        });
        result.skipped++;
        continue;
      }

      // A reply to a lead-capture question is stored on the contact first.
      const { data: pendingRows } = await getAdminDb()
        .from("pending_dms")
        .select("id, collect_field, collect_config, attempts, automation_id, rule_id")
        .eq("workspace_id", account.workspace_id)
        .eq("recipient_id", event.senderId)
        .eq("kind", "collect")
        .gt("expires_at", nowIso())
        .order("created_at", { ascending: false })
        .limit(1);
      const pending = pendingRows?.[0] as
        | {
            id: string;
            collect_field: string | null;
            collect_config: Record<string, unknown> | null;
            attempts: number | null;
            automation_id: string | null;
            rule_id: string | null;
          }
        | undefined;
      if (pending?.collect_field) {
        const field = parseCollectField(pending.collect_field);
        if (field) {
          const stored = (pending.collect_config ?? {}) as Record<string, unknown>;
          const config = normalizeCollectConfig({
            retryMessage: stored.retryMessage as string | undefined,
            skipMessage: stored.skipMessage as string | undefined,
            successMessage: stored.successMessage as string | undefined,
            skipKeywords: stored.skipKeywords as string[] | undefined,
            maxAttempts: stored.maxAttempts as number | undefined,
          });
          const attempts = Number(pending.attempts ?? 0);

          const reply = async (text: string) => {
            if (!token) return;
            await withRetry(
              () =>
                sendDirectMessage(
                  token,
                  event.instagramAccountId,
                  event.senderId,
                  text
                ),
              2
            );
            if (conversationId) {
              await recordMessage({
                workspaceId: account.workspace_id,
                conversationId,
                direction: "outbound",
                senderType: "bot",
                text,
              });
            }
          };

          // 1. Explicit skip.
          if (isSkipKeyword(event.messageText, config.skipKeywords)) {
            await reply(config.skipMessage);
            await deletePending(pending.id);
            await recordLeadEvent({
              workspaceId: account.workspace_id,
              automationId: pending.automation_id,
              ruleId: pending.rule_id,
              contactId,
              recipientId: event.senderId,
              kind: "skipped",
              field: pending.collect_field,
            });
            continue;
          }

          // 2. Validate.
          const validation = validateLeadValue(field.kind, event.messageText);
          if (!validation.valid) {
            const nextAttempts = attempts + 1;
            await recordLeadEvent({
              workspaceId: account.workspace_id,
              automationId: pending.automation_id,
              ruleId: pending.rule_id,
              contactId,
              recipientId: event.senderId,
              kind: "invalid",
              field: pending.collect_field,
              value: event.messageText.slice(0, 200),
            });
            if (nextAttempts >= config.maxAttempts) {
              await reply(config.skipMessage);
              await deletePending(pending.id);
              await recordLeadEvent({
                workspaceId: account.workspace_id,
                automationId: pending.automation_id,
                ruleId: pending.rule_id,
                contactId,
                recipientId: event.senderId,
                kind: "skipped",
                field: pending.collect_field,
              });
            } else {
              await getAdminDb()
                .from("pending_dms")
                .update({ attempts: nextAttempts })
                .eq("id", pending.id);
              await reply(config.retryMessage);
            }
            continue;
          }

          // 3. Save the value and confirm.
          const savedContactId = await saveContactField({
            workspaceId: account.workspace_id,
            recipientId: event.senderId,
            field,
            value: validation.normalized,
          });
          await deletePending(pending.id);
          await reply(config.successMessage);
          await recordLeadEvent({
            workspaceId: account.workspace_id,
            automationId: pending.automation_id,
            ruleId: pending.rule_id,
            contactId: savedContactId ?? contactId,
            recipientId: event.senderId,
            kind: "captured",
            field: pending.collect_field,
            value: validation.normalized.slice(0, 200),
          });
          // A lead answer is data, not a keyword - never also fire a rule on it.
          continue;
        }
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
          const inChatPrompt = await getFollowPromptByPending(
            optin.id,
            optin.workspace_id
          );
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
            const checks = await countFollowChecksForPending(
              optin.id,
              optin.workspace_id
            );
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
          } else if (released.skipped) {
            result.events.push({ kind: "message", accountId: event.instagramAccountId, outcome: "skipped", detail: released.skipped });
            result.skipped++;
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

      // Deterministic selection: specific keywords always beat catch-alls,
      // priority breaks ties, and the account fallback runs only if nothing
      // matched. This makes "Respond to all DMs" predictable in production.
      const fallback = normalizeFallbackReply(account.fallback);
      const candidates: RuleCandidate<DmRule>[] = selectInboundRuleCandidates(
        rules,
        event.messageText
      );
      if (fallback.enabled && fallback.message) {
        candidates.push({
          rule: {
            ...fallbackAsRule(fallback, account.id),
            workspace_id: account.workspace_id,
          },
          matchedKeyword: null,
          catchAll: false,
        });
      }

      // A rule throttled by `once_per_days` must not block a lower-priority
      // rule or the catch-all. An opt-out blocks every rule.
      const blocked = new Set<string>();
      let optedOut = false;
      if (candidates.length > 0) {
        optedOut = await isOptedOut(account.workspace_id, event.senderId);
        if (optedOut) {
          for (const candidate of candidates) blocked.add(candidate.rule.id);
        } else {
          for (const candidate of candidates) {
            const throttled = await recentlyMessaged(
              account.workspace_id,
              event.senderId,
              candidate.rule.id,
              candidate.rule.once_per_days
            );
            if (!throttled) break;
            blocked.add(candidate.rule.id);
          }
        }
      }

      const selection = pickDispatchableCandidate(candidates, blocked);
      if (!selection) {
        result.events.push({
          kind: "message",
          accountId: event.instagramAccountId,
          outcome: "ignored",
          detail: optedOut
            ? "Recipient opted out of automated DMs"
            : candidates.length > 0
              ? "All matching DM rules throttled"
              : "No matching DM rule and no fallback configured",
        });
        continue;
      }

      const chosen = selection.rule;
      const succeeded = await processDirectRule({
        workspaceId: account.workspace_id,
        accountId: event.instagramAccountId,
        accountDbId: account.id,
        token,
        recipientId: event.senderId,
        rule: chosen,
        externalId: event.messageId,
        matchedText: selection.matchedKeyword ?? event.messageText,
      });
      result.events.push({
        kind: "message",
        accountId: event.instagramAccountId,
        outcome: succeeded ? "sent" : "skipped",
        detail: `${selection.catchAll ? "Catch-all: " : chosen.trigger_type === "FALLBACK" ? "Fallback: " : ""}${chosen.name}`,
      });
      if (succeeded) result.sent++;
      else result.skipped++;
    } catch (error) {
      result.errors.push(`Inbound DM ${event.messageId} failed: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  // ── Postbacks → opt-in, tags, follow-ups ────────────────────────────────────
  for (const event of parsePostbackEvents(payload)) {
    try {
      const account = await getAccount(event.instagramAccountId);
      if (!account) continue;
      const token = await getToken(account);
      if (!token) continue;

      // Refresh Meta's 24-hour messaging window on any button tap. This is what
      // lets a follow-up be scheduled after the user engages with a button.
      if (hasAdminDb()) {
        try {
          await getAdminDb()
            .from("contacts")
            .update({ last_interaction_at: nowIso(), updated_at: nowIso() })
            .eq("workspace_id", account.workspace_id)
            .eq("instagram_id", event.userId);
        } catch {
          // Best effort.
        }
      }

      const [action, value] = event.payload.split(":");

      // Configurable postback routes (tag / branch / followup) take priority
      // over the built-in OPTIN flow so creators can build custom button
      // actions without changing code.
      const route = await loadPostbackRoute(account.workspace_id, event.payload);
      if (route && route.active) {
        const succeeded = await executePostbackRoute({
          route,
          event,
          account,
          token,
        });
        result.events.push({
          kind: "postback",
          accountId: event.instagramAccountId,
          outcome: succeeded ? "sent" : "skipped",
          detail: `${route.action}: ${route.payload}`,
        });
        if (succeeded) result.sent++;
        else result.skipped++;
        continue;
      }

      if (action === "OPTIN" && value) {
        const pending = await consumePending(value, {
          workspaceId: account.workspace_id,
          recipientId: event.userId,
          kind: "optin",
          instagramAccountId: account.id,
        });
        if (!pending) {
          result.events.push({ kind: "postback", accountId: event.instagramAccountId, outcome: "skipped", detail: "Opt-in link expired" });
          result.skipped++;
          continue;
        }

        // In-chat "Ask to follow" prompts have their own hard-gate resolver.
        const inChatPrompt = await getFollowPromptByPending(
          value,
          pending.workspace_id
        );
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
            // Keep the row retryable after a transient delivery failure.
            await releasePendingClaim(value);
            result.errors.push(`Follow prompt ${value} failed: ${describeMetaError(resolved.error)}`);
            result.events.push({ kind: "postback", accountId: event.instagramAccountId, outcome: "failed", detail: "Follow prompt delivery failed" });
            result.failed++;
          } else {
            // Not a follower yet: release the claim so the next tap works.
            await releasePendingClaim(value);
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
          const checks = await countFollowChecksForPending(
            value,
            pending.workspace_id
          );
          const expired = checks >= FOLLOW_GATE_LIMITS.maxChecksPerPending;
          if (expired) await deletePending(value);
          else await releasePendingClaim(value);
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
        } else if (released.skipped) {
          // The row is kept (e.g. hourly cap); let the follower retry.
          await releasePendingClaim(value);
          result.events.push({ kind: "postback", accountId: event.instagramAccountId, outcome: "skipped", detail: released.skipped });
          result.skipped++;
        } else {
          // Keep the pending row so the follower can try again after a
          // transient failure instead of losing the lead permanently.
          await releasePendingClaim(value);
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

      // Persist for re-run (T1.8) and diagnostics. Best-effort.
      if (hasAdminDb()) {
        try {
          await getAdminDb().from("story_events").upsert(
            {
              workspace_id: account.workspace_id,
              instagram_account_id: account.id,
              external_id: event.externalId,
              media_id: event.mediaId ?? null,
              sender_id: event.senderId,
              sender_username: event.senderName ?? null,
              kind: event.kind,
              reaction: event.reaction ?? null,
              text: event.text ?? null,
            },
            { onConflict: "workspace_id,external_id", ignoreDuplicates: true }
          );
        } catch (error) {
          console.warn("[story] Could not persist story event:", error);
        }
      }

      const triggerTypes =
        event.kind === "MENTION"
          ? ["STORY_MENTION"]
          : event.kind === "REACTION"
            ? ["STORY_REACTION"]
            : ["STORY_REPLY"];
      const candidates = (
        await getRules(account.workspace_id, triggerTypes)
      ).filter((rule) => rule.trigger_type === triggerTypes[0]);
      const selection = selectInboundRule(candidates, event.text ?? "");
      const chosen = selection.rule;
      const token = await getToken(account);
      if (!token) continue;

      if (!chosen) {
        result.events.push({ kind: "story", accountId: event.instagramAccountId, outcome: "ignored", detail: "No matching story rule" });
        continue;
      }
      // Mark this sender as handled by a story trigger so the same message
      // (delivered as an inbound DM by Meta) does not also fire a DM keyword
      // rule — that is the double-fire the audit calls out.
      await markStoryHandled(event.instagramAccountId, event.senderId, event.mediaId);
      // Only one live story rule should fire per mention (Zorcha parity).
      const succeeded = await processDirectRule({
        workspaceId: account.workspace_id,
        accountId: event.instagramAccountId,
        accountDbId: account.id,
        token,
        recipientId: event.senderId,
        username: event.senderName,
        rule: chosen,
        externalId: `story:${event.externalId}`,
        matchedText: selection.matchedKeyword ?? event.text ?? "",
      });
      result.events.push({
        kind: "story",
        accountId: event.instagramAccountId,
        outcome: succeeded ? "sent" : "skipped",
        detail: chosen.name,
      });
      if (succeeded) result.sent++;
      else result.skipped++;
    } catch (error) {
      result.errors.push(`Story event failed: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  // ── Reactions to our DMs (closest supported signal to "story reactions") ───
  for (const event of parseReactionEvents(payload)) {
    try {
      const account = await getAccount(event.instagramAccountId);
      if (!account) continue;
      const rules = (
        await getRules(account.workspace_id, ["MESSAGE_REACTION"])
      ).filter((rule) => {
        if (rule.keywords.length === 0) return true;
        const value = event.reaction.toLowerCase();
        const emoji = (event.emoji ?? "").toLowerCase();
        return rule.keywords.some((keyword) => {
          const needle = keyword.toLowerCase().trim();
          return Boolean(
            needle &&
              (value === needle || emoji === needle || value.includes(needle) || emoji.includes(needle))
          );
        });
      });
      const token = await getToken(account);
      if (!token) continue;
      if (rules.length === 0) {
        result.events.push({
          kind: "reaction",
          accountId: event.instagramAccountId,
          outcome: "ignored",
          detail: "No matching reaction rule",
        });
        continue;
      }
      const succeeded = await processDirectRule({
        workspaceId: account.workspace_id,
        accountId: event.instagramAccountId,
        accountDbId: account.id,
        token,
        recipientId: event.senderId,
        username: event.senderName,
        rule: rules[0],
        externalId: `reaction:${event.externalId}`,
        matchedText: event.emoji ?? event.reaction,
      });
      result.events.push({
        kind: "reaction",
        accountId: event.instagramAccountId,
        outcome: succeeded ? "sent" : "skipped",
        detail: rules[0].name,
      });
      if (succeeded) result.sent++;
      else result.skipped++;
    } catch (error) {
      result.errors.push(
        `Reaction event failed: ${error instanceof Error ? error.message : "unknown"}`
      );
    }
  }

  // ── Aggregate story insights (replies, taps) for analytics ─────────────────
  for (const insight of parseStoryInsightEvents(payload)) {
    try {
      const account = await getAccount(insight.instagramAccountId);
      if (!account || !hasAdminDb()) continue;
      const day = new Date().toISOString().slice(0, 10);
      const metrics = [
        { metric: "story_replies", value: insight.replies },
        { metric: "story_taps_forward", value: insight.tapsForward },
        { metric: "story_taps_back", value: insight.tapsBack },
        { metric: "story_impressions", value: insight.impressions },
        { metric: "story_reach", value: insight.reach },
        { metric: "story_exits", value: insight.exits },
      ];
      const { error } = await getAdminDb()
        .from("insight_snapshots")
        .upsert(
          metrics.map((item) => ({
            workspace_id: account.workspace_id,
            instagram_account_id: account.id,
            day,
            metric: item.metric,
            value: item.value,
          })),
          { onConflict: "instagram_account_id,day,metric" }
        );
      if (error) {
        result.errors.push(`Story insights could not be stored: ${error.message}`);
      }
    } catch (error) {
      result.errors.push(
        `Story insights failed: ${error instanceof Error ? error.message : "unknown"}`
      );
    }
  }

  // ── Shares to DMs ───────────────────────────────────────────────────────────
  for (const event of parseShareEvents(payload)) {
    try {
      const account = await getAccount(event.instagramAccountId);
      if (!account) continue;
      await persistShareEvent(account.workspace_id, account.id, event);
      const token = await getToken(account);
      if (!token) continue;

      // Campaign automations take priority over inbox rules so a creator who
      // configured a share campaign does not also fire a generic share rule.
      const { data: shareAutomations } = await getAdminDb()
        .from("automations")
        .select("*")
        .eq("workspace_id", account.workspace_id)
        .eq("trigger_type", "SHARE_TO_DM")
        .eq("active", true)
        .order("created_at", { ascending: true })
        .limit(5);

      if (shareAutomations && shareAutomations.length > 0) {
        for (const row of shareAutomations) {
          const auto = toAutomationLike(
            row as Parameters<typeof toAutomationLike>[0]
          );
          const outcome = await processShareEventForAutomation(event, auto);
          result.events.push({
            kind: "share",
            accountId: event.instagramAccountId,
            outcome: outcome.sent ? "sent" : "skipped",
            detail: outcome.sent
              ? auto.name ?? "Share campaign"
              : outcome.skipped ?? "Not eligible",
          });
          if (outcome.sent) result.sent++;
          else result.skipped++;
        }
        continue;
      }

      const rules = await getRules(account.workspace_id, ["SHARE_TO_DM"]);
      if (rules.length === 0) continue;
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

  // Delivery + read receipts. Meta only provides these for some accounts, so
  // they are applied best-effort and never block the rest of the batch.
  for (const event of parseDeliveryEvents(payload)) {
    try {
      const account = await getAccount(event.instagramAccountId);
      if (!account) continue;
      const at = event.watermark
        ? new Date(event.watermark).toISOString()
        : nowIso();
      await applyReceipt({
        workspaceId: account.workspace_id,
        instagramAccountId: account.id,
        recipientId: event.userId,
        kind: "delivered",
        at,
        mids: event.mids,
      });
      result.events.push({
        kind: "message",
        accountId: event.instagramAccountId,
        outcome: "sent",
        detail: "Delivery receipt recorded",
      });
    } catch (error) {
      result.errors.push(
        `Delivery receipt failed: ${error instanceof Error ? error.message : "unknown"}`
      );
    }
  }

  for (const event of parseReadEvents(payload)) {
    try {
      const account = await getAccount(event.instagramAccountId);
      if (!account) continue;
      const at = event.watermark
        ? new Date(event.watermark).toISOString()
        : nowIso();
      await applyReceipt({
        workspaceId: account.workspace_id,
        instagramAccountId: account.id,
        recipientId: event.userId,
        kind: "read",
        at,
      });
      result.events.push({
        kind: "read",
        accountId: event.instagramAccountId,
        outcome: "sent",
        detail: "Read receipt recorded",
      });
    } catch (error) {
      result.errors.push(
        `Read receipt failed: ${error instanceof Error ? error.message : "unknown"}`
      );
    }
  }

  result.avgLatencyMs = latencies.length
    ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
    : null;

  return result;
}
