import { randomUUID } from "crypto";
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
}

/** Acquires a short-lived distributed lock; null means another worker holds it. */
export async function acquireRedisLock(
  key: string,
  ttlSeconds = 45
): Promise<RedisLock | null> {
  if (!hasUpstashRedis()) return { key, token: "local" };
  try {
    const token = randomUUID();
    const result = await getRedis().set(key, token, { nx: true, ex: ttlSeconds });
    return result === "OK" ? { key, token } : null;
  } catch (error) {
    console.warn("[redis-lock] Acquire failed, proceeding without lock:", error);
    return { key, token: "local" };
  }
}

/** Releases the lock only if this invocation still owns it. */
export async function releaseRedisLock(lock: RedisLock | null): Promise<void> {
  if (!lock || !hasUpstashRedis() || lock.token === "local") return;
  try {
    const current = await getRedis().get<string>(lock.key);
    if (current === lock.token) await getRedis().del(lock.key);
  } catch (error) {
    // TTL will expire the lock; never block the worker on cleanup.
    console.warn("[redis-lock] Release failed:", error);
  }
}
