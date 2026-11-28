/**
 * Shared live-path delivery guards.
 *
 * Every path that can send an automated DM must pass the same safety checks in
 * the same order as the live webhook processor. This module exists so recovery
 * and admin endpoints cannot bypass opt-out, dedupe, cooldown or rate limits.
 *
 * Order (mirrors `processCommentEventForAutomation` / `sendCommentDm`):
 *   1. automation is active
 *   2. recipient has not opted out
 *   3. no SENT DM for this automation + recipient in the last 24h
 *   4. per-recipient/per-post cooldown
 *   5. account-wide hourly ceiling
 *   6. per-automation hourly cap
 *   7. follow gate (when enabled)
 */

import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { ACCOUNT_HOURLY_CEILING } from "@/lib/meta/limits";
import { acquireSendSlot, checkRecipientCooldown } from "@/lib/meta/rate-limit";
import { normalizeFollowGateConfig } from "@/lib/meta/follow-gate";
import {
  applyFollowGate,
  isOptedOut,
  type AutomationLike,
} from "@/lib/meta/webhook-processor";

export interface DeliveryGuardInput {
  workspaceId: string;
  recipientId: string;
  /** Instagram account id (the IGSID owner), not the database row id. */
  accountId: string;
  accountDbId: string | null;
  /** Media id used for the per-post cooldown. Empty string when unknown. */
  mediaId: string;
  token: string;
  auto: AutomationLike;
  /** `automations.active` for the campaign being delivered. */
  active: boolean;
  contactId?: string | null;
  username?: string | null;
  commentId?: string | null;
  keyword?: string;
}

export interface DeliveryGuardResult {
  allowed: boolean;
  skipped?: string;
}

export async function checkDeliveryGuards(
  input: DeliveryGuardInput
): Promise<DeliveryGuardResult> {
  if (!input.active) {
    return { allowed: false, skipped: "Automation is paused" };
  }
  if (!hasAdminDb()) {
    return { allowed: false, skipped: "Database unavailable" };
  }

  if (await isOptedOut(input.workspaceId, input.recipientId)) {
    return { allowed: false, skipped: "Recipient opted out of automated DMs" };
  }

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: existing } = await getAdminDb()
    .from("dm_logs")
    .select("id")
    .eq("automation_id", input.auto.id)
    .eq("recipient_id", input.recipientId)
    // A FAILED delivery is not a delivered message. Without this filter a
    // single rejected DM blocks every future send to that person for 24h.
    .eq("status", "SENT")
    .gte("sent_at", dayAgo)
    .limit(1)
    .maybeSingle();
  if (existing) {
    return { allowed: false, skipped: "Already messaged in 24h" };
  }

  const cooldownOk = await checkRecipientCooldown(
    input.accountId,
    input.mediaId,
    input.recipientId
  );
  if (!cooldownOk) {
    return { allowed: false, skipped: "Recipient cooldown (10 min per post)" };
  }

  // Account-level ceiling: Meta allows 750 private replies/hour per Instagram
  // account. Enforce a shared ceiling across every automation.
  const accountSlot = await acquireSendSlot(
    `${input.accountId}:account`,
    ACCOUNT_HOURLY_CEILING
  );
  if (!accountSlot.allowed) {
    return { allowed: false, skipped: "Account hourly ceiling reached" };
  }

  const limit = await acquireSendSlot(
    `${input.accountId}:${input.auto.id}`,
    input.auto.hourlyCap ?? 0
  );
  if (!limit.allowed) {
    return { allowed: false, skipped: "Automation hourly cap reached" };
  }

  if (input.auto.followGateEnabled) {
    const gate = await applyFollowGate({
      workspaceId: input.workspaceId,
      accountDbId: input.accountDbId,
      accountId: input.accountId,
      token: input.token,
      recipientId: input.recipientId,
      username: input.username,
      config: normalizeFollowGateConfig({
        enabled: true,
        openingMessage: input.auto.openingMessage,
        buttonLabel: input.auto.followGateButtonLabel,
        onUnavailable: input.auto.followGateOnUnavailable,
      }),
      automationId: input.auto.id,
      commentId: input.commentId ?? null,
      keyword: input.keyword,
      deliverMessage: input.auto.dmMessage,
      buttonUrl: input.auto.buttonUrl,
      contactId: input.contactId ?? null,
      mediaId: input.mediaId || null,
    });
    if (!gate.proceed) {
      return {
        allowed: false,
        skipped: gate.skipped ?? "Follow gate: not confirmed",
      };
    }
  }

  return { allowed: true };
}
