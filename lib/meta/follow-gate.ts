/**
 * Follow verification for the "Ask for Follow" gate.
 *
 * Meta's IG User `/followers` edge does not reliably answer "does user X follow
 * account Y" (no per-user filter on current API versions). The supported
 * signal is the User Profile API field `is_user_follow_business`, which is
 * available only after the person has messaged the business or tapped one of
 * our buttons (user consent). See:
 * https://developers.facebook.com/docs/messenger-platform/instagram/features/user-profile/
 *
 * This module is intentionally free of database and send-side imports so it
 * can be unit-tested and shared by comment automations, inbox/story/share
 * rules and the opt-in postback handler.
 */

import {
  FOLLOW_GATE_DEFAULTS,
  FOLLOW_GATE_LIMITS,
  normalizeFollowGatePolicy,
  type FollowGateUnavailablePolicy,
} from "@/lib/follow-gate-constants";
import { getRedis, hasUpstashRedis } from "@/lib/upstash";

export type FollowCheckStatus = "follower" | "not_follower" | "unavailable";
export type FollowCheckMethod = "user_profile" | "none";

export interface FollowVerification {
  status: FollowCheckStatus;
  method: FollowCheckMethod;
  /** Stable machine code: consent_required, token_invalid, network_error, meta_error_N, ... */
  reason?: string;
  username?: string | null;
  checkedAt: string;
  fromCache?: boolean;
}

export interface FollowGateConfigInput {
  enabled: boolean;
  openingMessage?: string | null;
  buttonLabel?: string | null;
  onUnavailable?: unknown;
}

export interface FollowGateConfig {
  enabled: boolean;
  openingMessage: string;
  buttonLabel: string;
  onUnavailable: FollowGateUnavailablePolicy;
}

export type FollowGateDecision = "deliver" | "ask";

const TRANSIENT_META_CODES = new Set([1, 2, 4, 17, 32, 100, 429, 613]);
const REQUEST_TIMEOUT_MS = 4000;
const MAX_ATTEMPTS = 3;

/** Coalesce concurrent checks for the same account/recipient (viral comment bursts). */
const inFlight = new Map<string, Promise<FollowVerification>>();

function apiBase(accessToken: string): string {
  const version = process.env.META_API_VERSION || "v21.0";
  // Instagram Login tokens live on graph.instagram.com; Page tokens on
  // graph.facebook.com. This mirrors instagramApiBase() in client.ts.
  return accessToken.trim().startsWith("IG")
    ? `https://graph.instagram.com/${version}`
    : `https://graph.facebook.com/${version}`;
}

function cacheKey(accountId: string, userIgsid: string): string {
  return `followgate:v2:${accountId}:${userIgsid}`;
}

function ttlFor(status: FollowCheckStatus): number {
  // A new follow can happen at any moment, so "not a follower" expires fast.
  return status === "follower"
    ? FOLLOW_GATE_LIMITS.verificationCacheMinutes * 60
    : 120;
}

async function readCache(key: string): Promise<FollowVerification | null> {
  if (!hasUpstashRedis()) return null;
  try {
    const cached = await getRedis().get<FollowVerification>(key);
    if (!cached || !cached.status) return null;
    return { ...cached, fromCache: true, checkedAt: cached.checkedAt };
  } catch {
    return null;
  }
}

async function writeCache(
  key: string,
  verification: FollowVerification
): Promise<void> {
  if (!hasUpstashRedis()) return;
  try {
    await getRedis().set(key, verification, { ex: ttlFor(verification.status) });
  } catch {
    // Cache is an optimisation. Verification must still work without it.
  }
}

export async function clearFollowCache(
  accountId: string,
  userIgsid: string
): Promise<void> {
  if (!hasUpstashRedis()) return;
  try {
    await getRedis().del(cacheKey(accountId, userIgsid));
  } catch {
    // Best effort.
  }
}

function metaErrorInfo(payload: unknown): { code: number | null; message: string } {
  const root = payload as Record<string, unknown> | null;
  const error = (root?.error ?? root ?? {}) as Record<string, unknown>;
  const code =
    typeof error.code === "number"
      ? error.code
      : typeof root?.code === "number"
        ? root.code
        : null;
  const message =
    typeof error.message === "string"
      ? error.message
      : typeof root?.message === "string"
        ? root.message
        : "";
  return { code, message };
}

function unavailable(
  reason: string,
  username?: string | null
): FollowVerification {
  return {
    status: "unavailable",
    method: "user_profile",
    reason,
    username,
    checkedAt: new Date().toISOString(),
  };
}

async function verifyUncached(
  accessToken: string,
  userIgsid: string
): Promise<FollowVerification> {
  const url = new URL(
    `${apiBase(accessToken)}/${encodeURIComponent(userIgsid)}`
  );
  url.searchParams.set("fields", "is_user_follow_business,username");

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const payload = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;

      if (res.ok) {
        const value = payload.is_user_follow_business;
        if (typeof value !== "boolean") {
          return unavailable("field_unavailable", payload.username as string);
        }
        return {
          status: value ? "follower" : "not_follower",
          method: "user_profile",
          username: (payload.username as string | null) ?? null,
          checkedAt: new Date().toISOString(),
        };
      }

      const { code, message } = metaErrorInfo(payload);
      const normalized = message.toLowerCase();
      if (code === 190 || normalized.includes("invalid oauth")) {
        return unavailable("token_invalid");
      }
      if (normalized.includes("consent")) {
        return unavailable("consent_required");
      }
      if (code !== null && TRANSIENT_META_CODES.has(code) && attempt < MAX_ATTEMPTS - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, 250 * (attempt + 1) + Math.floor(Math.random() * 200))
        );
        continue;
      }
      return unavailable(code === null ? `http_${res.status}` : `meta_error_${code}`);
    } catch {
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, 250 * (attempt + 1) + Math.floor(Math.random() * 200))
        );
        continue;
      }
      return unavailable("network_error");
    }
  }

  return unavailable("network_error");
}

/**
 * Verifies whether `userIgsid` follows the account that owns `accessToken`.
 *
 * Never throws: outages, permissions and Meta quirks are returned as an
 * explicit `unavailable` status so callers can apply their own policy instead
 * of silently failing open.
 */
export async function verifyFollowership(
  accessToken: string,
  accountId: string,
  userIgsid: string,
  expectedUsername?: string | null
): Promise<FollowVerification> {
  if (!accessToken || !userIgsid) {
    return unavailable("missing_identity");
  }

  const key = cacheKey(accountId, userIgsid);
  const cached = await readCache(key);
  if (cached) {
    // If an expected username was supplied, verify the cached identity still
    // matches — a spoofed or stale cache entry must not grant access.
    if (
      expectedUsername &&
      cached.username &&
      cached.username.toLowerCase() !== expectedUsername.toLowerCase().trim()
    ) {
      await clearFollowCache(accountId, userIgsid);
      // Fall through to a fresh verification.
    } else {
      return cached;
    }
  }

  const existing = inFlight.get(key);
  if (existing) return existing;

  const task = (async () => {
    const verification = await verifyUncached(accessToken, userIgsid);
    // Identity check: if the caller supplied an expected username, the
    // returned username must match. A mismatch means the IGSID was spoofed
    // or the Meta response is stale — treat as unavailable, never as follower.
    if (
      expectedUsername &&
      verification.status !== "unavailable" &&
      verification.username &&
      verification.username.toLowerCase() !== expectedUsername.toLowerCase().trim()
    ) {
      return unavailable("identity_mismatch", verification.username);
    }
    // Only cache definitive answers. "Unavailable" must be retried.
    if (verification.status !== "unavailable") {
      await writeCache(key, verification);
    }
    return verification;
  })();
  inFlight.set(key, task);
  try {
    return await task;
  } finally {
    inFlight.delete(key);
  }
}

export function normalizeFollowGateConfig(
  config?: FollowGateConfigInput | null
): FollowGateConfig {
  return {
    enabled: Boolean(config?.enabled),
    openingMessage:
      config?.openingMessage?.trim() || FOLLOW_GATE_DEFAULTS.openingMessage,
    buttonLabel:
      config?.buttonLabel?.trim()?.slice(0, FOLLOW_GATE_LIMITS.buttonLabel) ||
      FOLLOW_GATE_DEFAULTS.buttonLabel,
    onUnavailable: normalizeFollowGatePolicy(config?.onUnavailable),
  };
}

/**
 * Gate policy:
 * - disabled or confirmed follower → deliver
 * - confirmed non-follower → ask them to follow (opening DM + button)
 * - unavailable → "hold" asks again (safe default), "deliver" is an explicit
 *   operator choice logged as an exception.
 */
export function decideFollowGateAction(
  config: FollowGateConfig,
  verification: FollowVerification
): FollowGateDecision {
  if (!config.enabled) return "deliver";
  if (verification.status === "follower") return "deliver";
  if (verification.status === "not_follower") return "ask";
  return config.onUnavailable === "deliver" ? "deliver" : "ask";
}

// Kept exported for existing callers/tests. Copy rendering now lives in the
// dedicated opening-dm module so it can be reused and tested in isolation.
export { buildOpeningText } from "@/lib/meta/opening-dm";
