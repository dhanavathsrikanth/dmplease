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
} from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/vault";
import { prisma } from "@/lib/prisma";

/**
 * Meta Webhook Handshake Verification (GET /api/webhook)
 * Responds to Meta Graph API challenge when verifying callback URL
 */
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

/**
 * Meta Webhook Ingestion (POST /api/webhook)
 * Handles incoming Instagram comments, direct messages, and events
 */
export async function POST(request: NextRequest) {
  console.log(`[Meta Webhook] Received webhook POST event`);
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  // Validate HMAC SHA-256 Signature
  if (!verifyWebhookSignature(rawBody, signature)) {
    console.warn(`[Meta Webhook] Signature verification failed`);
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

  try {
    const dbUrl = process.env.DATABASE_URL || "";
    const hasDb = dbUrl && !dbUrl.includes("[YOUR-PASSWORD]");

    // 1. Process Instagram Comments
    const commentEvents = parseCommentEvents(payload);
    for (const event of commentEvents) {
      console.log(
        `[Meta Webhook] Comment from ${event.commenterName || event.commenterId} on ${event.instagramAccountId}: "${event.commentText}"`
      );

      if (hasDb) {
        // Find active automations matching this Instagram account and post/keyword
        const automations = await prisma.automation.findMany({
          where: {
            active: true,
            workspace: {
              instagramAccounts: {
                some: {
                  instagramId: event.instagramAccountId,
                },
              },
            },
          },
        });

        for (const auto of (automations as any[])) {
          // Check post scope matching
          if (
            auto.postScope === "SPECIFIC_POST" &&
            auto.postId &&
            auto.postId !== event.mediaId
          ) {
            continue;
          }

          const text = event.commentText.toLowerCase();
          const matches =
            !auto.triggerKeywords ||
            auto.triggerKeywords.length === 0 ||
            auto.triggerKeywords.some((k: string) =>
              text.includes(k.toLowerCase().trim())
            );

          if (matches) {
            console.log(
              `[Meta Webhook] Matched automation "${auto.name}" (${auto.id}) for comment ${event.commentId}`
            );

            // Fetch and decrypt access token
            let token: string | null = null;
            const account = await prisma.instagramAccount.findUnique({
              where: { instagramId: event.instagramAccountId },
            });

            if (account?.accessToken) {
              try {
                token = decryptToken(account.accessToken);
              } catch (e) {
                console.warn("[Meta Webhook] Failed to decrypt token:", e);
              }
            }

            if (!token && process.env.INSTAGRAM_ACCESS_TOKEN) {
              token = process.env.INSTAGRAM_ACCESS_TOKEN;
            }

            if (token) {
              let dispatchResult: any;
              if (auto.buttonText && auto.buttonUrl) {
                dispatchResult = await sendPrivateReplyWithButton(
                  token,
                  event.instagramAccountId,
                  event.commentId,
                  auto.dmMessage,
                  auto.buttonText,
                  auto.buttonUrl
                );
              } else {
                dispatchResult = await sendPrivateReply(
                  token,
                  event.instagramAccountId,
                  event.commentId,
                  auto.dmMessage
                );
              }

              console.log(
                `[Meta Webhook] Dispatched automated DM:`,
                dispatchResult
              );

              // Record in dmLogs
              try {
                await prisma.dmLog.create({
                  data: {
                    workspaceId: auto.workspaceId,
                    instagramAccountId: account?.id,
                    automationId: auto.id,
                    recipientId: event.commenterId,
                    recipientUsername: event.commenterName || "instagram_user",
                    triggerKeyword: auto.triggerKeywords[0] || "AUTO_MATCH",
                    dmMessage: auto.dmMessage,
                    status: dispatchResult?.error ? "FAILED" : "SENT",
                  },
                });
              } catch (logErr) {
                console.warn("[Meta Webhook] dmLog creation skipped:", logErr);
              }
            }
          }
        }
      }
    }

    // 2. Process Instagram Direct Messages
    const messageEvents = parseMessageEvents(payload);
    for (const event of messageEvents) {
      console.log(
        `[Meta Webhook] Inbound DM from ${event.senderId} on ${event.instagramAccountId}: "${event.messageText}"`
      );
    }

    // 3. Process Button Postbacks
    const postbackEvents = parsePostbackEvents(payload);
    for (const event of postbackEvents) {
      console.log(
        `[Meta Webhook] Postback from user ${event.userId}: payload="${event.payload}"`
      );
    }

    // Acknowledge event receipt to Meta immediately
    return NextResponse.json(
      { success: true, status: "EVENT_RECEIVED" },
      { status: 200 }
    );
  } catch (error) {
    console.error(`[Meta Webhook] Ingestion error:`, error);
    return NextResponse.json(
      { success: true, status: "EVENT_RECEIVED" },
      { status: 200 }
    );
  }
}
