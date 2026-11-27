/**
 * Account health monitoring.
 *
 * Tracks consecutive failures, last send, last error and token status per
 * Instagram account. Redis is the hot store (fast, auto-expiring); the DB
 * holds the durable snapshot. A safety pause is always visible and reversible
 * by the creator — never silent.
 */

import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { getRedis, hasUpstashRedis } from "@/lib/upstash";
import { captureServerEvent } from "@/lib/posthog-server";

const HEALTH_TTL_SECONDS = 24 * 60 * 60;
const PAUSE_THRESHOLD = 5;
const ALERT_THRESHOLD = 3;

export type AccountHealthStatus = "healthy" | "degraded" | "paused" | "token_invalid";

export interface AccountHealth {
  accountId: string;
  status: AccountHealthStatus;
  consecutiveFailures: number;
  lastSendAt: string | null;
  lastError: string | null;
  safetyPaused: boolean;
  tokenStatus: "valid" | "invalid" | "unknown";
}

function healthKey(accountId: string): string {
  return `safety:health:${accountId}`;
}

interface CachedHealth {
  consecutiveFailures: number;
  lastSendAt: string | null;
  lastError: string | null;
  safetyPaused: boolean;
}

async function readCached(accountId: string): Promise<CachedHealth | null> {
  if (!hasUpstashRedis()) return null;
  try {
    return await getRedis().get<CachedHealth>(healthKey(accountId));
  } catch {
    return null;
  }
}

async function writeCached(accountId: string, health: CachedHealth): Promise<void> {
  if (!hasUpstashRedis()) return;
  try {
    await getRedis().set(healthKey(accountId), health, { ex: HEALTH_TTL_SECONDS });
  } catch {
    // Best effort.
  }
}

async function readDb(accountId: string): Promise<CachedHealth | null> {
  if (!hasAdminDb()) return null;
  try {
    const { data } = await getAdminDb()
      .from("instagram_accounts")
      .select("consecutive_failures, last_send_at, last_error, safety_paused, token_status")
      .eq("id", accountId)
      .maybeSingle();
    if (!data) return null;
    return {
      consecutiveFailures: Number(data.consecutive_failures ?? 0),
      lastSendAt: data.last_send_at ? String(data.last_send_at) : null,
      lastError: data.last_error ? String(data.last_error) : null,
      safetyPaused: Boolean(data.safety_paused),
    };
  } catch {
    return null;
  }
}

async function writeDb(accountId: string, health: CachedHealth, tokenStatus?: string): Promise<void> {
  if (!hasAdminDb()) return;
  try {
    const patch: Record<string, unknown> = {
      consecutive_failures: health.consecutiveFailures,
      last_send_at: health.lastSendAt,
      last_error: health.lastError,
      safety_paused: health.safetyPaused,
    };
    if (tokenStatus) patch.token_status = tokenStatus;
    await getAdminDb()
      .from("instagram_accounts")
      .update(patch)
      .eq("id", accountId);
  } catch {
    // DB snapshot is best effort; Redis still holds the truth.
  }
}

export async function recordSendOutcome(input: {
  accountId: string;
  outcome: "sent" | "failed" | "throttled" | "rate_limited";
  error?: string | null;
}): Promise<AccountHealth> {
  const cached = (await readCached(input.accountId)) ?? (await readDb(input.accountId)) ?? {
    consecutiveFailures: 0,
    lastSendAt: null,
    lastError: null,
    safetyPaused: false,
  };

  const now = new Date().toISOString();
  let consecutiveFailures = cached.consecutiveFailures;
  let lastError = cached.lastError;
  let safetyPaused = cached.safetyPaused;
  let lastSendAt = cached.lastSendAt;

  if (input.outcome === "sent") {
    consecutiveFailures = 0;
    lastError = null;
    lastSendAt = now;
  } else if (input.outcome === "failed") {
    consecutiveFailures += 1;
    lastError = input.error ?? "Unknown error";
    if (consecutiveFailures >= PAUSE_THRESHOLD && !safetyPaused) {
      safetyPaused = true;
      captureServerEvent({
        event: "safety_auto_paused",
        properties: {
          account_id: input.accountId,
          consecutive_failures: consecutiveFailures,
          reason: lastError.slice(0, 120),
        },
        anonymous: true,
      });
    } else if (consecutiveFailures >= ALERT_THRESHOLD) {
      captureServerEvent({
        event: "safety_degraded",
        properties: {
          account_id: input.accountId,
          consecutive_failures: consecutiveFailures,
        },
        anonymous: true,
      });
    }
  }

  const health: CachedHealth = {
    consecutiveFailures,
    lastSendAt,
    lastError,
    safetyPaused,
  };
  await writeCached(input.accountId, health);
  await writeDb(input.accountId, health);

  return getAccountHealth(input.accountId);
}

export async function getAccountHealth(accountId: string): Promise<AccountHealth> {
  const cached = (await readCached(accountId)) ?? (await readDb(accountId)) ?? {
    consecutiveFailures: 0,
    lastSendAt: null,
    lastError: null,
    safetyPaused: false,
  };

  let tokenStatus: "valid" | "invalid" | "unknown" = "unknown";
  if (hasAdminDb()) {
    try {
      const { data } = await getAdminDb()
        .from("instagram_accounts")
        .select("token_status")
        .eq("id", accountId)
        .maybeSingle();
      tokenStatus =
        data?.token_status === "invalid"
          ? "invalid"
          : data?.token_status === "valid"
            ? "valid"
            : "unknown";
    } catch {
      tokenStatus = "unknown";
    }
  }

  const status: AccountHealthStatus = cached.safetyPaused
    ? "paused"
    : tokenStatus === "invalid"
      ? "token_invalid"
      : cached.consecutiveFailures >= ALERT_THRESHOLD
        ? "degraded"
        : "healthy";

  return {
    accountId,
    status,
    consecutiveFailures: cached.consecutiveFailures,
    lastSendAt: cached.lastSendAt,
    lastError: cached.lastError,
    safetyPaused: cached.safetyPaused,
    tokenStatus,
  };
}

export async function setSafetyPaused(
  accountId: string,
  paused: boolean
): Promise<void> {
  const cached = (await readCached(accountId)) ?? {
    consecutiveFailures: 0,
    lastSendAt: null,
    lastError: null,
    safetyPaused: paused,
  };
  cached.safetyPaused = paused;
  if (!paused) cached.consecutiveFailures = 0;
  await writeCached(accountId, cached);
  await writeDb(accountId, cached);
}

export function isSafetyPaused(health: AccountHealth): boolean {
  return health.safetyPaused;
}
