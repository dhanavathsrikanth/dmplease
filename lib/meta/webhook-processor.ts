import { prisma } from "@/lib/prisma";
import { decryptToken } from "@/lib/meta/vault";
import {
  checkIsFollower,
  getUserMedia,
  postPublicCommentReply,
  sendDirectMessage,
  sendPrivateReply,
  sendPrivateReplyWithButton,
  type MetaApiError,
} from "@/lib/meta/client";
import {
  checkRateLimit,
  isViralSpike,
  pickVariant,
  randomizedDelay,
} from "@/lib/meta/safety";
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
import { hasDatabaseUrl } from "@/lib/config";

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
  template: string,
  vars: { username?: string; link?: string; keyword?: string }
): string {
  return template
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

// ── Persistence helpers (raw SQL keeps compatibility with the current client) ─

async function getAccount(instagramId: string) {
  if (!hasDatabaseUrl()) return null;
  try {
    const rows = await prisma.$queryRaw<
      Array<{ id: string; workspace_id: string; access_token: string | null }>
    >`
      SELECT id::text, workspace_id::text, access_token
      FROM instagram_accounts WHERE instagram_id = ${instagramId} LIMIT 1
    `;
    return rows[0] ?? null;
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
  if (!hasDatabaseUrl()) return null;
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO contacts (workspace_id, instagram_id, username, source)
      VALUES (${workspaceId}::uuid, ${instagramId}, ${username ?? null}, ${source})
      ON CONFLICT (workspace_id, instagram_id)
      DO UPDATE SET username = COALESCE(EXCLUDED.username, contacts.username), updated_at = now()
      RETURNING id::text AS id
    `;
    return rows[0]?.id ?? null;
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
  if (!hasDatabaseUrl()) return null;
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO conversations (workspace_id, instagram_account_id, contact_id)
      VALUES (${workspaceId}::uuid, ${instagramAccountId}::uuid, ${contactId}::uuid)
      ON CONFLICT (contact_id, instagram_account_id)
      DO UPDATE SET last_message_at = now(), status = 'open'
      RETURNING id::text AS id
    `;
    return rows[0]?.id ?? null;
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
  if (!hasDatabaseUrl()) return false;
  try {
    await prisma.$executeRaw`
      INSERT INTO messages (workspace_id, conversation_id, external_id, direction, sender_type, content_type, content, delivery_status)
      VALUES (
        ${input.workspaceId}::uuid, ${input.conversationId}::uuid, ${input.externalId ?? null},
        ${input.direction}, ${input.senderType}, 'text',
        jsonb_build_object('text', ${input.text}), ${input.status ?? null}
      )
      ON CONFLICT (conversation_id, external_id) DO NOTHING
    `;
    await prisma.$executeRaw`
      UPDATE conversations SET last_message_at = now() WHERE id = ${input.conversationId}::uuid
    `;
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
  if (!hasDatabaseUrl()) return;
  try {
    await prisma.$executeRaw`
      INSERT INTO safety_events (workspace_id, instagram_account_id, recipient_id, kind)
      VALUES (${input.workspaceId}::uuid, ${input.instagramAccountId ?? null}::uuid, ${input.recipientId ?? null}, ${input.kind ?? "dm"})
    `;
  } catch {
    // Safety ledger is best-effort.
  }
}

async function getRules(
  workspaceId: string,
  triggerTypes: string[]
): Promise<DmRule[]> {
  if (!hasDatabaseUrl()) return [];
  try {
    return await prisma.$queryRaw<DmRule[]>`
      SELECT id::text, workspace_id::text, name, trigger_type, keywords, message,
             variants, button_text, button_url, collect_field, once_per_days, priority
      FROM dm_rules
      WHERE workspace_id = ${workspaceId}::uuid
        AND active = true
        AND trigger_type = ANY(${triggerTypes}::text[])
      ORDER BY priority DESC, created_at ASC
    `;
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
  if (!hasDatabaseUrl()) return false;
  try {
    const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM safety_events
        WHERE workspace_id = ${workspaceId}::uuid
          AND recipient_id = ${recipientId}
          AND kind = ${`rule:${ruleId}`}
          AND created_at > now() - (${days}::text || ' days')::interval
      ) AS exists
    `;
    return rows[0]?.exists ?? false;
  } catch {
    return false;
  }
}

async function persistCommentEvent(
  workspaceId: string,
  accountId: string | null,
  event: WebhookCommentEvent
): Promise<void> {
  if (!hasDatabaseUrl()) return;
  try {
    await prisma.$executeRaw`
      INSERT INTO comment_events (workspace_id, instagram_account_id, external_id, media_id, commenter_id, commenter_username, text)
      VALUES (${workspaceId}::uuid, ${accountId}::uuid, ${event.commentId}, ${event.mediaId}, ${event.commenterId}, ${event.commenterName ?? null}, ${event.commentText})
      ON CONFLICT (workspace_id, external_id) DO NOTHING
    `;
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
  if (!hasDatabaseUrl()) return null;
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO pending_dms (workspace_id, kind, automation_id, rule_id, instagram_account_id,
        recipient_id, comment_id, message, button_text, button_url, collect_field)
      VALUES (${input.workspaceId}::uuid, ${input.kind}, ${input.automationId ?? null}::uuid,
        ${input.ruleId ?? null}::uuid, ${input.instagramAccountId ?? null}::uuid,
        ${input.recipientId}, ${input.commentId ?? null}, ${input.message ?? null},
        ${input.buttonText ?? null}, ${input.buttonUrl ?? null}, ${input.collectField ?? null})
      RETURNING id::text AS id
    `;
    return rows[0]?.id ?? null;
  } catch (error) {
    console.warn("[webhook] Could not create pending DM:", error);
    return null;
  }
}

async function consumePending(id: string) {
  if (!hasDatabaseUrl()) return null;
  try {
    const rows = await prisma.$queryRaw<
      Array<{
        id: string; workspace_id: string; kind: string; automation_id: string | null;
        rule_id: string | null; instagram_account_id: string | null;
        recipient_id: string; comment_id: string | null; message: string | null;
        button_text: string | null; button_url: string | null; collect_field: string | null;
      }>
    >`
      SELECT id::text, workspace_id::text, kind, automation_id::text, rule_id::text,
             instagram_account_id::text, recipient_id, comment_id, message,
             button_text, button_url, collect_field
      FROM pending_dms WHERE id = ${id}::uuid AND expires_at > now() LIMIT 1
    `;
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

async function deletePending(id: string): Promise<void> {
  if (!hasDatabaseUrl()) return;
  try {
    await prisma.$executeRaw`DELETE FROM pending_dms WHERE id = ${id}::uuid`;
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
  if (!hasDatabaseUrl()) return;
  try {
    if (field === "email") {
      await prisma.$executeRaw`
        UPDATE contacts SET email = ${value}, updated_at = now()
        WHERE workspace_id = ${workspaceId}::uuid AND instagram_id = ${recipientId}
      `;
    } else if (field === "phone") {
      await prisma.$executeRaw`
        UPDATE contacts SET phone = ${value}, updated_at = now()
        WHERE workspace_id = ${workspaceId}::uuid AND instagram_id = ${recipientId}
      `;
    } else if (field === "display_name") {
      await prisma.$executeRaw`
        UPDATE contacts SET display_name = ${value}, updated_at = now()
        WHERE workspace_id = ${workspaceId}::uuid AND instagram_id = ${recipientId}
      `;
    } else if (field === "opted_in_at") {
      await prisma.$executeRaw`
        UPDATE contacts SET opted_in_at = now(), updated_at = now()
        WHERE workspace_id = ${workspaceId}::uuid AND instagram_id = ${recipientId}
      `;
    } else {
      await prisma.$executeRaw`
        UPDATE contacts SET follow_verified_at = now(), updated_at = now()
        WHERE workspace_id = ${workspaceId}::uuid AND instagram_id = ${recipientId}
      `;
    }
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
}): Promise<boolean> {
  const { auto } = input;
  const cap = auto.hourlyCap ?? 0;
  const limit = checkRateLimit(`${input.accountId}:${auto.id}`, cap);
  if (!limit.allowed) {
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
    console.warn(`[safety] Hourly cap reached for ${auto.name}; message queued (retry in ${limit.retryAfterMs}ms)`);
    return false;
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
          `${new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").origin}/go/${trackedUrl}`
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

  await prisma.dmLog.create({
    data: {
      workspaceId: input.workspaceId,
      instagramAccountId: input.accountDbId,
      automationId: auto.id,
      recipientId: input.recipientId,
      recipientUsername: input.username || "instagram_user",
      triggerKeyword: input.keyword,
      dmMessage: text,
      status: succeeded ? "SENT" : "FAILED",
    },
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

  return succeeded;
}

/**
 * Exported for the retro re-run endpoint. Applies one stored comment event to
 * one automation with the same guards as live webhook delivery.
 */
export async function processCommentEventForAutomation(
  event: WebhookCommentEvent,
  auto: AutomationLike
): Promise<{ sent: boolean; skipped?: string }> {
  if (!hasDatabaseUrl()) return { sent: false, skipped: "Database unavailable" };

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

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const existing = await prisma.dmLog.findFirst({
    where: {
      automationId: auto.id,
      recipientId: event.commenterId,
      sentAt: { gte: dayAgo },
    },
    select: { id: true },
  });
  if (existing) return { sent: false, skipped: "Already messaged in 24h" };

  const contactId = await ensureContact(
    auto.workspaceId,
    event.commenterId,
    event.commenterName,
    "comment"
  );

  if (auto.followGateEnabled && contactId) {
    const rows = await prisma.$queryRaw<Array<{ opted_in_at: Date | null }>>`
      SELECT opted_in_at FROM contacts WHERE id = ${contactId}::uuid LIMIT 1
    `;
    const optedIn = Boolean(rows[0]?.opted_in_at);
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
        await withRetry(() =>
          sendPrivateReplyWithButton(
            token,
            event.instagramAccountId,
            event.commentId,
            personalizeMessage(opening, { username: event.commenterName, keyword: matchedKeyword }),
            "Get it",
            `OPTIN:${pendingId}`
          )
        );
      }
      return { sent: false, skipped: "Opening message sent; waiting for opt-in" };
    }

    const isFollower = await checkIsFollower(token, event.instagramAccountId, event.commenterId);
    if (!isFollower) return { sent: false, skipped: "Follow gate: not a follower" };
    await markContactLedger(auto.workspaceId, event.commenterId, "follow_verified_at", new Date().toISOString());
  }

  const sent = await sendCommentDm({
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
  });

  return sent ? { sent: true } : { sent: false, skipped: "Meta rejected the DM or cap reached" };
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
          `${text}\n\n${rule.button_text}: ${`${new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").origin}/go/${trackedUrl}`}`
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
  };
  const latencies: number[] = [];
  const dbAvailable = hasDatabaseUrl();

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

      const recentComments = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*)::bigint AS count FROM comment_events
        WHERE workspace_id = ${account.workspace_id}::uuid AND received_at > now() - interval '5 minutes'
      `;
      if (isViralSpike(Number(recentComments[0]?.count ?? 0))) {
        console.warn("[safety] Viral spike detected — throttling delivery");
        await jitter(500, 2000);
      }

      const automations = await prisma.automation.findMany({
        where: {
          active: true,
          workspace: { instagramAccounts: { some: { instagramId: event.instagramAccountId } } },
        },
      });

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
          if (outcome.sent) result.sent++;
          else result.skipped++;
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

      // A reply to a lead-capture question is stored on the contact first.
      const pendingRows = await prisma.$queryRaw<
        Array<{ id: string; collect_field: string | null }>
      >`
        SELECT id::text, collect_field FROM pending_dms
        WHERE workspace_id = ${account.workspace_id}::uuid
          AND recipient_id = ${event.senderId}
          AND kind = 'collect' AND expires_at > now()
        ORDER BY created_at DESC LIMIT 1
      `;
      const pending = pendingRows[0];
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
          const auto = await prisma.automation.findUnique({
            where: { id: pending.automation_id },
            select: { id: true, workspaceId: true, dmMessage: true, buttonText: true, buttonUrl: true, publicReplyEnabled: true, publicReplyMessages: true, hourlyCap: true, dmVariants: true },
          });
          if (auto) {
            await sendCommentDm({
              token,
              accountId: event.instagramAccountId,
              commentId: pending.comment_id,
              workspaceId: auto.workspaceId,
              recipientId: event.userId,
              auto: auto as AutomationLike,
              keyword: "OPTIN",
              contactId: await ensureContact(auto.workspaceId, event.userId, undefined, "optin"),
              accountDbId: account.id,
            });
          }
        } else if (pending.message) {
          await withRetry(() => sendDirectMessage(token, event.instagramAccountId, event.userId, pending.message!));
        }
        await deletePending(value);
        result.events.push({ kind: "postback", accountId: event.instagramAccountId, outcome: "sent", detail: "Opt-in confirmed" });
        result.sent++;
        continue;
      }

      if (action === "TAG" && value) {
        if (hasDatabaseUrl()) {
          await prisma.$executeRaw`
            UPDATE contacts SET tags = array_append(tags, ${value}), updated_at = now()
            WHERE workspace_id = ${account.workspace_id}::uuid AND instagram_id = ${event.userId}
            AND NOT (${value} = ANY(tags))
          `;
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
