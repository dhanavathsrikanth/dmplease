/**
 * Plain-English explanations for safety event kinds.
 *
 * Shared by the dashboard, the diagnostics page and any future digest email so
 * a machine code never reaches a creator verbatim.
 */

export const SAFETY_EVENT_EXPLANATIONS: Record<string, string> = {
  dm: "An automated DM was sent.",
  follow_gate_opening: "An opening DM was sent asking someone to follow before receiving the guide.",
  follow_gate_exception:
    "Meta could not verify follow status, so the creator's hold/deliver policy released the content anyway.",
  follow_gate_skip_recent:
    "The follow tap was skipped because the person already messaged you in the last 24 hours.",
  viral_spike: "A comment burst was detected and delivery was slowed to protect the account.",
  viral_throttle: "A send was paused because the account was in critical throttle mode.",
  rate_limit_breach: "Meta's hourly send limit was reached; the DM was parked in the queue for a retry.",
  opt_out: "A follower replied STOP/unsubscribe and was removed from future automated DMs.",
  follow_growth: "A new follower was attributed to an in-chat follow prompt.",
  instagram_token_invalid: "The connected Instagram token was rejected by Meta and needs reconnection.",
};

export function explainSafetyEvent(kind: string): string {
  return SAFETY_EVENT_EXPLANATIONS[kind] ?? `Safety event: ${kind}`;
}
