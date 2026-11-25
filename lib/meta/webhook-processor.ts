import { prisma } from "@/lib/prisma";
import { decryptToken } from "@/lib/meta/vault";
import {
  checkIsFollower,
  getUserMedia,
  postPublicCommentReply,
  sendPrivateReply,
  sendPrivateReplyWithButton,
} from "@/lib/meta/client";
import {
  parseCommentEvents,
  parseMessageEvents,
  parsePostbackEvents,
  type WebhookPayload,
} from "@/lib/meta/webhook";
import { hasDatabaseUrl } from "@/lib/config";

export type EventOutcome = "sent" | "skipped" | "failed" | "ignored";

export interface ProcessedEvent {
  kind: "comment" | "message" | "postback";
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

/** Small jitter to spread bursts against Meta's per-token rate limits. */
export function jitter(minMs = 50, maxMs = 350): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/** Retry Meta calls on rate-limit and transient error codes with backoff. */
export async function withRetry<T extends { error?: any }>(
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
    const backoffMs = Math.pow(2, attempt) * 500;
    console.warn(
      `[webhook] Retryable Meta error ${errorCode}, attempt ${attempt}/${maxRetries}, waiting ${backoffMs}ms`
    );
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
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
  auto: {
    postScope?: string | null;
    postId?: string | null;
  },
  event: { mediaId: string },
  token: string,
  latestMediaCache: Map<string, Promise<string | null>>
): Promise<boolean> {
  if (auto.postScope === "SPECIFIC_POST") {
    return Boolean(auto.postId && auto.postId === event.mediaId);
  }

  if (auto.postScope === "NEXT_POST") {
    // "Next post" is resolved as the most recent published post/reel at the
    // moment the comment arrives. Cache per account to avoid extra API calls.
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

  // ANY_POST and unknown scopes listen everywhere.
  return true;
}

function findMatchingKeyword(
  keywords: string[] | null | undefined,
  commentText: string
): string | null {
  if (!keywords || keywords.length === 0) return "AUTO_MATCH";
  const normalized = commentText.toLowerCase().trim();
  return (
    keywords.find((keyword) =>
      normalized.includes(keyword.toLowerCase().trim())
    ) ?? null
  );
}

/**
 * Processes a verified Meta webhook payload.
 * Called from `after()` so Meta receives its 200 response before this runs.
 */
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
  const latestMediaCache = new Map<string, Promise<string | null>>();
  const dbAvailable = hasDatabaseUrl();

  if (!dbAvailable) {
    result.errors.push("DATABASE_URL is not configured; webhook events were not persisted.");
  }

  // ── Comment → DM ────────────────────────────────────────────────────────────
  for (const event of parseCommentEvents(payload)) {
    const startedAt = Date.now();

    if (!dbAvailable) {
      result.events.push({
        kind: "comment",
        accountId: event.instagramAccountId,
        outcome: "skipped",
        detail: "Database unavailable",
      });
      result.skipped++;
      continue;
    }

    try {
      const automations = await prisma.automation.findMany({
        where: {
          active: true,
          workspace: {
            instagramAccounts: {
              some: { instagramId: event.instagramAccountId },
            },
          },
        },
      });

      if (automations.length === 0) {
        result.events.push({
          kind: "comment",
          accountId: event.instagramAccountId,
          outcome: "skipped",
          detail: "No active automation for this account",
        });
        result.skipped++;
        continue;
      }

      for (const auto of automations) {
        try {
          const matchedKeyword = findMatchingKeyword(auto.triggerKeywords, event.commentText);
          if (matchedKeyword === null) continue;

          const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
          const existingLog = await prisma.dmLog.findFirst({
            where: {
              automationId: auto.id,
              recipientId: event.commenterId,
              sentAt: { gte: windowStart },
            },
          });
          if (existingLog) {
            result.events.push({
              kind: "comment",
              accountId: event.instagramAccountId,
              outcome: "skipped",
              detail: `Duplicate guard: automation "${auto.name}" already messaged this user in 24h`,
            });
            result.skipped++;
            continue;
          }

          const account = await prisma.instagramAccount.findUnique({
            where: { instagramId: event.instagramAccountId },
          });

          let token: string | null = null;
          if (account?.accessToken) {
            try {
              token = decryptToken(account.accessToken);
            } catch (error) {
              result.errors.push(
                `Could not decrypt token for account ${event.instagramAccountId}: ${error instanceof Error ? error.message : "unknown error"}`
              );
            }
          }
          if (!token && process.env.INSTAGRAM_ACCESS_TOKEN) {
            token = process.env.INSTAGRAM_ACCESS_TOKEN;
          }
          if (!token) continue;

          // Post scope needs the decrypted token (NEXT_POST resolves latest media).
          if (!(await matchesPostScope(auto, event, token, latestMediaCache))) continue;

          if (auto.followGateEnabled) {
            const isFollower = await checkIsFollower(
              token,
              event.instagramAccountId,
              event.commenterId
            );
            if (!isFollower) {
              result.events.push({
                kind: "comment",
                accountId: event.instagramAccountId,
                outcome: "skipped",
                detail: "Follow gate: commenter does not follow the account",
              });
              result.skipped++;
              continue;
            }
          }

          const vars = {
            username: event.commenterName || "there",
            link: auto.buttonUrl || "",
            keyword: matchedKeyword,
          };
          const personalizedDm = personalizeMessage(auto.dmMessage, vars);

          await jitter(50, 350);

          const dispatch = async () => {
            if (auto.buttonText && auto.buttonUrl) {
              return sendPrivateReplyWithButton(
                token!,
                event.instagramAccountId,
                event.commentId,
                personalizedDm,
                personalizeMessage(auto.buttonText!, vars),
                auto.buttonUrl!
              );
            }
            return sendPrivateReply(
              token!,
              event.instagramAccountId,
              event.commentId,
              personalizedDm
            );
          };

          const dispatchResult = await withRetry(dispatch, 3);
          const succeeded = !dispatchResult?.error;

          if (succeeded && auto.publicReplyEnabled) {
            const replies = auto.publicReplyMessages || [];
            const replyText = replies.length > 0
              ? replies[Math.floor(Math.random() * replies.length)]
              : "Sent you a DM! 📩";
            await jitter(100, 500);
            await withRetry(
              () => postPublicCommentReply(token!, event.commentId, personalizeMessage(replyText, vars)),
              2
            );
          }

          await prisma.dmLog.create({
            data: {
              workspaceId: auto.workspaceId,
              instagramAccountId: account?.id ?? null,
              automationId: auto.id,
              recipientId: event.commenterId,
              recipientUsername: event.commenterName || "instagram_user",
              triggerKeyword: matchedKeyword,
              dmMessage: personalizedDm,
              status: succeeded ? "SENT" : "FAILED",
            },
          });

          const latencyMs = Date.now() - startedAt;
          latencies.push(latencyMs);
          result.events.push({
            kind: "comment",
            accountId: event.instagramAccountId,
            outcome: succeeded ? "sent" : "failed",
            detail: succeeded ? auto.name : "Meta rejected the DM",
            latencyMs,
          });
          if (succeeded) result.sent++;
          else result.failed++;
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown error";
          result.errors.push(`Automation "${auto.name}" failed: ${message}`);
          result.events.push({
            kind: "comment",
            accountId: event.instagramAccountId,
            outcome: "failed",
            detail: message,
          });
          result.failed++;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      result.errors.push(`Comment event ${event.commentId} failed: ${message}`);
      result.events.push({
        kind: "comment",
        accountId: event.instagramAccountId,
        outcome: "failed",
        detail: message,
      });
      result.failed++;
    }
  }

  // ── Inbound DMs and postbacks — explicitly deferred to Tier 1 ────────────────
  for (const event of parseMessageEvents(payload)) {
    result.events.push({
      kind: "message",
      accountId: event.instagramAccountId,
      outcome: "ignored",
      detail: "Inbound DM automation ships in Tier 1 (T1.1)",
    });
  }

  for (const event of parsePostbackEvents(payload)) {
    result.events.push({
      kind: "postback",
      accountId: event.instagramAccountId,
      outcome: "ignored",
      detail: "Postback routing ships in Tier 1 (T1.3)",
    });
  }

  result.avgLatencyMs = latencies.length
    ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
    : null;

  return result;
}
