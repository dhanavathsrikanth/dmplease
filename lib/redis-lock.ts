import { randomUUID } from "crypto";
import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { getRedis, hasUpstashRedis } from "@/lib/upstash";

export interface CronRun<T> {
  locked: boolean;
  value?: T;
}

/** Runs a cron handler under a distributed lock; returns `locked` when skipped. */
export async function withCronLock<T>(
  key: string,
  ttlSeconds: number,
  handler: () => Promise<T>
): Promise<CronRun<T>> {
  const lock = await acquireRedisLock(key, ttlSeconds);
  if (!lock) return { locked: true };
  try {
    return { locked: false, value: await handler() };
  } finally {
    await releaseRedisLock(lock);
  }
}

export interface RedisLock {
  key: string;
  token: string;
  /** Which store actually holds the lock, so release targets the same one. */
  store: "redis" | "db";
}

/**
 * Acquires a short-lived distributed lock; null means another worker holds it
 * or no store is reachable. Redis is the fast path; when it is unavailable or
 * errors, the Postgres lock table takes over. If both fail we fail closed
 * rather than letting every worker run the job concurrently.
 */
export async function acquireRedisLock(
  key: string,
  ttlSeconds = 45
): Promise<RedisLock | null> {
  const token = randomUUID();

  if (hasUpstashRedis()) {
    try {
      const result = await getRedis().set(key, token, {
        nx: true,
        ex: ttlSeconds,
      });
      // A null result means another worker holds the Redis lock.
      return result === "OK" ? { key, token, store: "redis" } : null;
    } catch (error) {
      console.warn(
        "[redis-lock] Redis acquire failed, falling back to Postgres:",
        error
      );
    }
  }

  return acquireDbLock(key, token, ttlSeconds);
}

/** Claims the Postgres lock row; null when held elsewhere or unreachable. */
async function acquireDbLock(
  key: string,
  token: string,
  ttlSeconds: number
): Promise<RedisLock | null> {
  if (!hasAdminDb()) return null;
  try {
    const { data, error } = await getAdminDb().rpc("acquire_cron_lock", {
      p_key: key,
      p_token: token,
      p_ttl_seconds: ttlSeconds,
    });
    if (error) {
      console.warn("[redis-lock] Postgres acquire failed:", error.message);
      return null;
    }
    return data === true ? { key, token, store: "db" } : null;
  } catch (error) {
    console.warn("[redis-lock] Postgres acquire failed:", error);
    return null;
  }
}

/** Releases the lock only if this invocation still owns it. */
export async function releaseRedisLock(lock: RedisLock | null): Promise<void> {
  if (!lock) return;

  if (lock.store === "db") {
    if (!hasAdminDb()) return;
    try {
      const { error } = await getAdminDb().rpc("release_cron_lock", {
        p_key: lock.key,
        p_token: lock.token,
      });
      if (error) {
        console.warn("[redis-lock] Postgres release failed:", error.message);
      }
    } catch (error) {
      // TTL will expire the lock; never block the worker on cleanup.
      console.warn("[redis-lock] Postgres release failed:", error);
    }
    return;
  }

  if (!hasUpstashRedis()) return;
  try {
    const current = await getRedis().get<string>(lock.key);
    if (current === lock.token) await getRedis().del(lock.key);
  } catch (error) {
    // TTL will expire the lock; never block the worker on cleanup.
    console.warn("[redis-lock] Release failed:", error);
  }
}
