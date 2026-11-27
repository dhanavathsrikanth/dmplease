/**
 * Shared, dependency-free constants for the "Ask for Follow" feature.
 *
 * Safe to import from both server code and client components. Keep this file
 * free of server-only imports (crypto, Supabase, Meta client) so the campaign
 * builder and rule manager can use the same source of truth.
 */

export type FollowGateUnavailablePolicy = "hold" | "deliver";

export const FOLLOW_GATE_POLICIES: readonly FollowGateUnavailablePolicy[] = [
  "hold",
  "deliver",
];

export const FOLLOW_GATE_DEFAULTS = {
  /** Shown before we can verify follow status. {username} and {keyword} are supported. */
  openingMessage:
    "Hey {username}! Follow the account first, then tap below and I'll send your {keyword}. 👇",
  /** Meta button titles are capped at 20 characters. */
  buttonLabel: "I'm following ✅",
  /** Never deliver gated content when Meta cannot confirm the relationship. */
  onUnavailable: "hold" as FollowGateUnavailablePolicy,
} as const;

export const FOLLOW_GATE_LIMITS = {
  openingMessage: 500,
  buttonLabel: 20,
  /**
   * How long a confirmed follow is trusted before we re-check Meta.
   *
   * A person can unfollow after receiving the link, so a new request after
   * this window always triggers a fresh verification. Within the window we
   * reuse the result to avoid duplicate checks in a burst.
   */
  reverificationMinutes: 15,
  /** How many times a pending opt-in can be retried before it is closed. */
  maxChecksPerPending: 3,
} as const;

export function normalizeFollowGatePolicy(
  value: unknown
): FollowGateUnavailablePolicy {
  return value === "deliver" ? "deliver" : "hold";
}

/**
 * T1.11: true when the person messaged the creator within the window, so the
 * follow tap can be skipped and the content delivered immediately.
 */
export function isRecentInbound(
  lastInboundAt: string | null | undefined,
  hours = 24,
  now = Date.now()
): boolean {
  if (!lastInboundAt) return false;
  const time = new Date(lastInboundAt).getTime();
  if (Number.isNaN(time)) return false;
  return time >= now - hours * 60 * 60 * 1000;
}

/**
 * Human-readable explanation of a verification outcome, used in the UI,
 * the job ledger and diagnostics. `reason` values are stable machine codes.
 */
export const FOLLOW_GATE_REASONS: Record<string, string> = {
  consent_required:
    "Meta requires the person to message or tap a button before follow status can be read.",
  identity_mismatch:
    "The verified username did not match the commenter. Treated as unverified for safety.",
  token_invalid: "The connected Instagram token needs to be reconnected.",
  network_error: "Meta could not be reached in time.",
  field_unavailable:
    "This account/token cannot expose follow status (permission or account type).",
  meta_error_190: "The connected Instagram token needs to be reconnected.",
  recent_verification: "Verified recently; no extra API call was needed.",
  recent_inbound:
    "The person messaged you in the last 24 hours, so the follow tap was skipped.",
};

export function describeFollowGateReason(reason?: string | null): string {
  if (!reason) return "No additional detail.";
  if (reason.startsWith("meta_error_")) {
    return `Meta rejected the request (code ${reason.slice("meta_error_".length)}).`;
  }
  return FOLLOW_GATE_REASONS[reason] ?? reason;
}
