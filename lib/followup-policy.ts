/**
 * Pure decision rules for 24h follow-ups.
 *
 * Everything here is deterministic and side-effect free, so the cron engine
 * can be tested without a database, Redis or Meta. The engine only supplies
 * facts; these functions decide what they mean.
 */

import { FOLLOWUP_LIMITS } from "@/lib/followup-constants";

export type AnchorSource = "opt_in" | "first_dm" | "none";

export interface FollowupAnchorInput {
  /** `contacts.opted_in_at` — the moment consent was confirmed. */
  optedInAt?: string | null;
  /** `dm_logs.sent_at` for the campaign's first DM. */
  firstDmAt?: string | null;
}

export interface FollowupAnchor {
  at: string | null;
  source: AnchorSource;
}

function validTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

/**
 * The 24h clock starts at opt-in, not at the first DM.
 *
 * For Ask-for-Follow campaigns the opt-in is the real start of the
 * conversation (and what reopens Meta's messaging window). A follower who
 * takes time to confirm should not get their follow-up early. Campaigns
 * without an opt-in fall back to the first DM, which preserves the old
 * behavior for existing automations. A stale opt-in from another campaign is
 * ignored so it cannot make this follow-up fire immediately.
 */
export function resolveAnchor(input: FollowupAnchorInput): FollowupAnchor {
  const optedIn = validTime(input.optedInAt);
  const firstDm = validTime(input.firstDmAt);

  // `contacts.opted_in_at` is workspace-wide. Ignore an opt-in that predates
  // this campaign's first DM by more than a day — it almost certainly belongs
  // to another automation and would make this follow-up fire immediately.
  const OPT_IN_LEAD_MS = 24 * 60 * 60 * 1000;
  if (
    optedIn !== null &&
    (firstDm === null || optedIn >= firstDm - OPT_IN_LEAD_MS)
  ) {
    return { at: new Date(optedIn).toISOString(), source: "opt_in" };
  }
  if (firstDm !== null) {
    return { at: new Date(firstDm).toISOString(), source: "first_dm" };
  }
  return { at: null, source: "none" };
}

export function isFollowupDue(
  anchor: FollowupAnchor,
  delayMinutes: number,
  now: number = Date.now()
): boolean {
  const at = validTime(anchor.at);
  if (at === null) return false;
  const delay = Math.max(
    FOLLOWUP_LIMITS.minDelayMinutes,
    Number(delayMinutes) || FOLLOWUP_LIMITS.minDelayMinutes
  );
  return at + delay * 60 * 1000 <= now;
}

export interface FollowupEngagement {
  /** Latest non-bot tracked-link click for this contact, if any. */
  clickedAt?: string | null;
  /** Latest inbound contact message for this contact, if any. */
  repliedAt?: string | null;
}

export type CancellationReason = "click" | "reply" | null;

/**
 * A human action after the anchor means the conversation is already alive —
 * another templated message would be noise (and a spam signal). We cancel on
 * the earliest such action so the reason is unambiguous.
 */
export function cancellationReason(
  engagement: FollowupEngagement,
  anchor: FollowupAnchor
): CancellationReason {
  const anchorTime = validTime(anchor.at);
  if (anchorTime === null) return null;

  const candidates: Array<{ reason: Exclude<CancellationReason, null>; at: number }> = [];
  const click = validTime(engagement.clickedAt);
  const reply = validTime(engagement.repliedAt);
  if (click !== null && click > anchorTime) candidates.push({ reason: "click", at: click });
  if (reply !== null && reply > anchorTime) candidates.push({ reason: "reply", at: reply });

  candidates.sort((a, b) => a.at - b.at);
  return candidates[0]?.reason ?? null;
}

export function nextStepNumber(existingSteps: number[]): number {
  const used = new Set(existingSteps.map(Number));
  let candidate = 1;
  while (used.has(candidate)) candidate++;
  return candidate;
}
