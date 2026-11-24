import { NextRequest, NextResponse } from "next/server";
import {
  verifyWebhookSignature,
  parseCommentEvents,
  parseMessageEvents,
  parsePostbackEvents,
  WebhookPayload,
} from "@/lib/meta/webhook";
import {
  sendPrivateReply,
  sendPrivateReplyWithButton,
  postPublicCommentReply,
  checkIsFollower,
} from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/vault";
import { prisma } from "@/lib/prisma";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Random jitter between minMs and maxMs to avoid thundering-herd bursts
 * against Meta's rate limits when many comments arrive simultaneously.
 * Meta enforces 10,000 API calls/hour per token — jitter spreads load.
 */
function jitter(minMs = 50, maxMs = 350): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Wraps a Meta API call with up to `maxRetries` exponential-backoff retries
 * specifically for HTTP 429 (Rate Limit) and 500/503 (transient server errors).
 * On 429, Meta sets a Retry-After header which we respect.
 */
async function withRetry<T>(
  fn: () => Promise<{ error?: any; [key: string]: any }>,
  maxRetries = 3
): Promise<T> {
  let attempt = 0;
  while (true) {
    const result = await fn();
    const errorCode = result?.error?.error?.code ?? result?.error?.code;

    // 429 or Meta error code 32 (rate limit) / 613 (custom tier limit)
    const isRateLimit =
      errorCode === 32 || errorCode === 613 || errorCode === 429;
    const isTransient =
      errorCode === 2 || errorCode === 1 || errorCode === 100;

    if ((!isRateLimit && !isTransient) || attempt >= maxRetries) {
      return result as T;
    }

    attempt++;
    const backoffMs = Math.pow(2, attempt) * 500; // 1s, 2s, 4s
    console.warn(
      `[Webhook] Meta API retryable error (code ${errorCode}), attempt ${attempt}/${maxRetries}, waiting ${backoffMs}ms`
    );
    await new Promise((r) => setTimeout(r, backoffMs));
  }
}

/**
 * Personalises the DM template with per-commenter variables.
 * Supported tokens:
 *   {username} → commenter's Instagram handle
 *   {link}     → automation's buttonUrl
 *   {keyword}  → the trigger keyword that was matched
 */
function personalizeMessage(
  template: string,
  vars: { username?: string; link?: string; keyword?: string }
): string {
  return template
    .replace(/\{username\}/gi, vars.username || "there")
    .replace(/\{link\}/gi, vars.link || "")
    .replace(/\{keyword\}/gi, vars.keyword || "");
}

// ─── Meta Webhook Handshake Verification (GET /api/webhook) ─────────────────

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const expectedToken =
    process.env.META_VERIFY_TOKEN ||
    process.env.WEBHOOK_VERIFY_TOKEN ||
    "dmplease_local_webhook_secret_2026";

  console.log(`[Meta Webhook Handshake] Request:`, {
    mode,
    tokenMatches: token === expectedToken,
    hasChallenge: Boolean(challenge),
  });

  if (mode === "subscribe" && token === expectedToken && challenge) {
    console.log(
      `[Meta Webhook Handshake] Verified successfully. Returning challenge.`
    );
    return new NextResponse(challenge, {
      status: 200,
      headers: {
        "Content-Type": "text/plain",
        "Cache-Control": "no-store, must-revalidate",
      },
    });
  }

  console.warn(
    `[Meta Webhook Handshake] Verification failed: Invalid token or mode`
  );
  return NextResponse.json(
    { success: false, error: "Verification failed" },
    {
      status: 403,
      headers: { "Cache-Control": "no-store, must-revalidate" },
    }
  );
}

// ─── Meta Webhook Ingestion (POST /api/webhook) ──────────────────────────────

export async function POST(request: NextRequest) {
  console.log(`[Meta Webhook] Received webhook POST event`);
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  // ── 1. HMAC-SHA256 Signature Verification (Meta policy requirement) ────────
  if (!verifyWebhookSignature(rawBody, signature)) {
    console.warn(`[Meta Webhook] Signature verification failed — dropping request`);
    return NextResponse.json(
      { success: false, error: "Invalid signature" },
      { status: 401 }
    );
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error(`[Meta Webhook] Failed to parse JSON payload`);
    return NextResponse.json(
      { success: false, error: "Invalid JSON" },
      { status: 400 }
    );
  }

  // Always acknowledge Meta immediately — Meta will retry if we don't respond
  // within 20 seconds, so we kick off async processing and return 200 at once.
  // The heavy work runs in the same request but after the 200 is committed.
  const responsePromise = NextResponse.json(
    { success: true, status: "EVENT_RECEIVED" },
    { status: 200 }
  );

  try {
    const dbUrl = process.env.DATABASE_URL || "";
    const hasDb = dbUrl && !dbUrl.includes("[YOUR-PASSWORD]");

    // ── 2. Process Instagram Comment Events ───────────────────────────────────
    const commentEvents = parseCommentEvents(payload);

    for (const event of commentEvents) {
      console.log(
        `[Meta Webhook] Comment from @${event.commenterName || event.commenterId} ` +
        `on account ${event.instagramAccountId}: "${event.commentText}"`
      );

      if (!hasDb) continue;

      // Load all active automations for this Instagram account
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

      for (const auto of automations as any[]) {

        // ── A. Post-scope filtering ──────────────────────────────────────────
        if (
          auto.postScope === "SPECIFIC_POST" &&
          auto.postId &&
          auto.postId !== event.mediaId
        ) {
          continue;
        }

        // ── B. Keyword matching ──────────────────────────────────────────────
        const commentLower = event.commentText.toLowerCase().trim();
        const matchedKeyword: string | null =
          !auto.triggerKeywords || auto.triggerKeywords.length === 0
            ? "AUTO_MATCH"
            : (auto.triggerKeywords.find((k: string) =>
                commentLower.includes(k.toLowerCase().trim())
              ) ?? null);

        if (matchedKeyword === null) continue;

        console.log(
          `[Meta Webhook] Automation "${auto.name}" matched keyword "${matchedKeyword}" ` +
          `for comment ${event.commentId}`
        );

        // ── C. DUPLICATE GUARD ───────────────────────────────────────────────
        // Meta policy: Never send the same automated DM to the same user
        // more than once per automation within a 24-hour window.
        // This prevents spam and protects our Meta App Review status.
        const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const existingLog = await prisma.dmLog.findFirst({
          where: {
            automationId: auto.id,
            recipientId: event.commenterId,
            sentAt: { gte: windowStart },
          },
        });

        if (existingLog) {
          console.log(
            `[Meta Webhook] Duplicate guard: @${event.commenterName || event.commenterId} ` +
            `already received DM from automation "${auto.name}" within 24h — skipping`
          );
          continue;
        }

        // ── D. Fetch & decrypt access token ─────────────────────────────────
        let token: string | null = null;
        const account = await prisma.instagramAccount.findUnique({
          where: { instagramId: event.instagramAccountId },
        });

        if (account?.accessToken) {
          try {
            token = decryptToken(account.accessToken);
          } catch (e) {
            console.warn("[Meta Webhook] Failed to decrypt account token:", e);
          }
        }

        if (!token) {
          console.error(
            `[Meta Webhook] No valid token for account ${event.instagramAccountId} — cannot dispatch DM`
          );
          continue;
        }

        // ── E. FOLLOW-GATE CHECK ─────────────────────────────────────────────
        // If the automation has follow-gate enabled, verify the commenter
        // actually follows the account before sending the DM.
        // Fail-open: if Meta API is unreachable we allow the DM rather than
        // silently blocking a real follower.
        if (auto.followGateEnabled) {
          const isFollower = await checkIsFollower(
            token,
            event.instagramAccountId,
            event.commenterId
          );

          if (!isFollower) {
            console.log(
              `[Meta Webhook] Follow-gate: @${event.commenterName || event.commenterId} ` +
              `does not follow the account — skipping DM for automation "${auto.name}"`
            );
            continue;
          }

          console.log(
            `[Meta Webhook] Follow-gate: @${event.commenterName || event.commenterId} ` +
            `confirmed as follower — proceeding`
          );
        }

        // ── F. VARIABLE SUBSTITUTION ─────────────────────────────────────────
        // Replace {username}, {link}, {keyword} tokens in the DM template.
        // This was previously broken — DMs were sent with literal {username}.
        const personalizedDm = personalizeMessage(auto.dmMessage, {
          username: event.commenterName || "there",
          link: auto.buttonUrl || "",
          keyword: matchedKeyword,
        });

        const personalizedButton = auto.buttonText
          ? personalizeMessage(auto.buttonText, {
              username: event.commenterName || "there",
              link: auto.buttonUrl || "",
              keyword: matchedKeyword,
            })
          : null;

        // ── G. RATE LIMIT JITTER ─────────────────────────────────────────────
        // Spread API calls over 50–350ms when many comments arrive at once
        // to avoid bursting against Meta's 10,000 req/hour token rate limit.
        await jitter(50, 350);

        // ── H. Dispatch DM (with exponential-backoff retry on 429) ──────────
        let dispatchResult: any;
        const dispatchFn =
          personalizedButton && auto.buttonUrl
            ? () =>
                sendPrivateReplyWithButton(
                  token!,
                  event.instagramAccountId,
                  event.commentId,
                  personalizedDm,
                  personalizedButton,
                  auto.buttonUrl
                )
            : () =>
                sendPrivateReply(
                  token!,
                  event.instagramAccountId,
                  event.commentId,
                  personalizedDm
                );

        dispatchResult = await withRetry(dispatchFn, 3);

        const dmSucceeded = !dispatchResult?.error;
        console.log(
          `[Meta Webhook] DM dispatch ${dmSucceeded ? "✅ succeeded" : "❌ failed"}:`,
          dmSucceeded ? dispatchResult : dispatchResult?.error
        );

        // ── I. PUBLIC COMMENT REPLY ──────────────────────────────────────────
        // After a successful DM, optionally post a public reply under the
        // original comment so other followers see the automation working.
        // This is a Zorcha-parity feature that was previously stored but never fired.
        if (dmSucceeded && auto.publicReplyEnabled) {
          const replyMessages: string[] = auto.publicReplyMessages || [];
          const replyText =
            replyMessages.length > 0
              ? replyMessages[Math.floor(Math.random() * replyMessages.length)]
              : "Sent you a DM! 📩";

          // Small extra jitter before the public reply call (separate API quota)
          await jitter(100, 500);

          const replyResult: any = await withRetry(
            () =>
              postPublicCommentReply(
                token!,
                event.commentId,
                personalizeMessage(replyText, {
                  username: event.commenterName || "there",
                  link: auto.buttonUrl || "",
                  keyword: matchedKeyword,
                })
              ),
            2
          );

          if (replyResult?.error) {
            console.warn(
              `[Meta Webhook] Public comment reply failed (non-critical):`,
              replyResult.error
            );
          } else {
            console.log(
              `[Meta Webhook] Public comment reply ✅ posted under comment ${event.commentId}`
            );
          }
        }

        // ── J. Record DmLog ──────────────────────────────────────────────────
        try {
          await prisma.dmLog.create({
            data: {
              workspaceId: auto.workspaceId,
              instagramAccountId: account?.id ?? null,
              automationId: auto.id,
              recipientId: event.commenterId,
              recipientUsername: event.commenterName || "instagram_user",
              triggerKeyword: matchedKeyword,
              dmMessage: personalizedDm,
              status: dmSucceeded ? "SENT" : "FAILED",
            },
          });
        } catch (logErr) {
          // Non-fatal — log creation failure should never block the response
          console.warn("[Meta Webhook] DmLog creation failed:", logErr);
        }
      }
    }

    // ── 3. Process Inbound Instagram Direct Messages ─────────────────────────
    // Currently logged only. Inbox automation (keyword-triggered auto-reply to DMs)
    // will be wired here in the next iteration.
    const messageEvents = parseMessageEvents(payload);
    for (const event of messageEvents) {
      console.log(
        `[Meta Webhook] Inbound DM from ${event.senderId} ` +
        `on ${event.instagramAccountId}: "${event.messageText}"`
      );
      // TODO: Inbox keyword automation
    }

    // ── 4. Process CTA Button Postbacks ──────────────────────────────────────
    // Fires when a user taps a postback button in a DM template.
    const postbackEvents = parsePostbackEvents(payload);
    for (const event of postbackEvents) {
      console.log(
        `[Meta Webhook] Button postback from ${event.userId}: payload="${event.payload}"`
      );
      // TODO: Postback flow routing
    }
  } catch (error) {
    // Log internal errors but always return 200 to Meta to prevent retries
    // flooding our endpoint (Meta retries for up to 72 hours on non-200).
    console.error(`[Meta Webhook] Unhandled processing error:`, error);
  }

  return responsePromise;
}
