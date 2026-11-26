import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { cleanEnv } from "@/lib/config";
import { decryptToken } from "@/lib/meta/vault";
import { captureServerEvent } from "@/lib/posthog-server";
import {
  checkIsFollower,
  getUserMedia,
  postPublicCommentReply,
  sendDirectMessage,
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
import { recordMetricEvent } from "@/lib/metrics";
import { createTrackedLink } from "@/lib/tracking";
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
    const { data, error } = await getAdminDb()
      .from("dm_rules")
      .select("id, workspace_id, name, trigger_type, keywords, message, variants, button_text, button_url, collect_field, once_per_days, priority")
      .eq("workspace_id", workspaceId)
      .eq("active", true)
      .in("trigger_type", triggerTypes)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []) as DmRule[];
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
  const text = personalizeMessage(template, vars);
  const trackedUrl = auto.buttonUrl
    ? createTrackedLink({
        workspaceId: input.workspaceId,
        automationId: auto.id,
        contactId: input.contactId ?? undefined,
        url: personalizeMessage(auto.buttonUrl, vars),
      })
    : null;

  await jitter(50, 350);

  const dispatch = () =>
    auto.buttonText && trackedUrl
      ? sendPrivateReplyWithButton(
          input.token,
          input.accountId,
          input.commentId,
          text,
          personalizeMessage(auto.buttonText, vars),
          `${new URL(cleanEnv("NEXT_PUBLIC_SITE_URL") || "http://localhost:3000").origin}/go/${trackedUrl}`
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

  if (auto.followGateEnabled && contactId) {
    const { data: contactRow } = await getAdminDb()
      .from("contacts")
      .select("opted_in_at")
      .eq("id", contactId)
      .maybeSingle();
    const optedIn = Boolean(contactRow?.opted_in_at);
    if (!optedIn) {
      const opening = auto.openingMessage || "Tap below to get your {keyword}. 👇";
      const pendingId = await createPending({
        workspaceId: auto.workspaceId,
        kind: "optin",
        automationId: auto.id,
        instagramAccountId: account.id,
        recipientId: event.commenterId,
        commentId: event.commentId,
        message: auto.dmMessage,
        buttonText: auto.buttonText || "Get it",
        buttonUrl: auto.buttonUrl,
      });
      if (pendingId) {
        const openingResult = await withRetry(() =>
          sendPrivateReplyWithButton(
            token,
            event.instagramAccountId,
            event.commentId,
            personalizeMessage(opening, { username: event.commenterName, keyword: matchedKeyword }),
            "Get it",
            `OPTIN:${pendingId}`
          )
        );
        const code = metaErrorCode(openingResult?.error);
        if (code === 190) {
          await markTokenInvalid(
            account.id,
            auto.workspaceId,
            "Meta error 190: invalid OAuth access token"
          );
          return {
            sent: false,
            skipped: "Token invalid — reconnect required",
            error: openingResult.error,
          };
        }
      }
      return { sent: false, skipped: "Opening message sent; waiting for opt-in" };
    }

    const isFollower = await checkIsFollower(token, event.instagramAccountId, event.commenterId);
    if (!isFollower) return { sent: false, skipped: "Follow gate: not a follower" };
    await markContactLedger(auto.workspaceId, event.commenterId, "follow_verified_at", new Date().toISOString());
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
  const conversationId = contactId
    ? await ensureConversation(input.workspaceId, input.accountDbId, contactId)
    : null;

  const variant = pickVariant(rule.variants);
  const text = personalizeMessage(variant.text ?? rule.message, {
    username: input.username,
    link: rule.button_url ?? "",
    keyword: input.matchedText ?? "",
  });

  await jitter(50, 350);
  const trackedUrl = rule.button_url
    ? createTrackedLink({
        workspaceId: input.workspaceId,
        contactId: contactId ?? undefined,
        url: personalizeMessage(rule.button_url, { username: input.username }),
      })
    : null;

  const result = await withRetry(() =>
    rule.button_text && trackedUrl
      ? sendDirectMessage(
          input.token,
          input.accountId,
          input.recipientId,
          `${text}\n\n${rule.button_text}: ${`${new URL(cleanEnv("NEXT_PUBLIC_SITE_URL") || "http://localhost:3000").origin}/go/${trackedUrl}`}`
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
}): Promise<{ sent: boolean; error?: MetaApiError }> {
  const variants = input.auto.dmVariants ?? [];
  const variant = pickVariant(variants);
  const template = variant.text ?? input.auto.dmMessage ?? "";

  let link = input.auto.buttonUrl || "";
  if (input.auto.buttonUrl) {
    const token = createTrackedLink({
      workspaceId: input.workspaceId,
      automationId: input.auto.id,
      contactId: input.contactId ?? undefined,
      url: personalizeMessage(input.auto.buttonUrl, { keyword: "OPTIN" }),
    });
    if (token) {
      const origin = new URL(
        cleanEnv("NEXT_PUBLIC_SITE_URL") || "http://localhost:3000"
      ).origin;
      link = `${origin}/go/${token}`;
    }
  }

  const text = personalizeMessage(template, {
    username: "there",
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

      const rules = await getRules(account.workspace_id, ["DM_KEYWORD"]);
      const token = await getToken(event.instagramAccountId, account);
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
        const isFollower = await checkIsFollower(token, event.instagramAccountId, event.userId);
        if (!isFollower) {
          result.events.push({ kind: "postback", accountId: event.instagramAccountId, outcome: "skipped", detail: "Follow required before delivery" });
          result.skipped++;
          continue;
        }
        await markContactLedger(pending.workspace_id, event.userId, "opted_in_at", new Date().toISOString());
        await markContactLedger(pending.workspace_id, event.userId, "follow_verified_at", new Date().toISOString());

        if (pending.comment_id && pending.automation_id) {
          const { data: autoRow } = await getAdminDb()
            .from("automations")
            .select("id, workspace_id, dm_message, button_text, button_url, public_reply_enabled, public_reply_messages, hourly_cap, dm_variants")
            .eq("id", pending.automation_id)
            .maybeSingle();
          const auto: AutomationLike | null = autoRow
            ? {
                id: autoRow.id,
                workspaceId: autoRow.workspace_id,
                dmMessage: autoRow.dm_message,
                buttonText: autoRow.button_text,
                buttonUrl: autoRow.button_url,
                publicReplyEnabled: autoRow.public_reply_enabled,
                publicReplyMessages: autoRow.public_reply_messages,
                hourlyCap: autoRow.hourly_cap,
                dmVariants: autoRow.dm_variants,
              }
            : null;
          if (auto) {
            const contactId = await ensureContact(
              auto.workspaceId,
              event.userId,
              undefined,
              "optin"
            );
            const outcome = await sendOptinDm({
              token,
              accountId: event.instagramAccountId,
              accountDbId: account.id,
              workspaceId: auto.workspaceId,
              recipientId: event.userId,
              auto,
              contactId,
            });
            if (outcome.sent) {
              await deletePending(value);
              result.events.push({ kind: "postback", accountId: event.instagramAccountId, outcome: "sent", detail: "Opt-in confirmed" });
              result.sent++;
            } else {
              // Keep the pending row so the follower can tap again after a
              // transient failure instead of losing the lead permanently.
              const code = metaErrorCode(outcome.error);
              if (code === 190) {
                await markTokenInvalid(account.id, auto.workspaceId, "Meta error 190: invalid OAuth access token");
              }
              result.errors.push(`Postback ${value} failed: ${code ?? "unknown Meta error"}`);
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
        }
        if (pending.message) {
          const outcome = await withRetry(() =>
            sendDirectMessage(token, event.instagramAccountId, event.userId, pending.message!)
          );
          if (outcome?.error) {
            result.errors.push(`Postback message failed: ${metaErrorCode(outcome.error) ?? "unknown"}`);
            result.failed++;
            continue;
          }
        }
        await deletePending(value);
        result.events.push({ kind: "postback", accountId: event.instagramAccountId, outcome: "sent", detail: "Opt-in confirmed" });
        result.sent++;
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
