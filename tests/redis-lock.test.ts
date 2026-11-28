import { beforeEach, describe, expect, it, vi } from "vitest";

interface Call {
  store: "redis" | "db";
  op: string;
  args: unknown[];
}

const state = vi.hoisted(() => ({
  redisAvailable: true,
  dbAvailable: true,
  setResult: "OK" as string | null,
  setError: null as Error | null,
  getResult: null as string | null,
  lastSetToken: null as string | null,
  acquireResult: true as boolean | null,
  acquireError: null as { message: string } | null,
  releaseError: null as { message: string } | null,
  calls: [] as Call[],
}));

vi.mock("@/lib/upstash", () => ({
  hasUpstashRedis: () => state.redisAvailable,
  getRedis: () => ({
    set: async (key: string, value: string, opts: unknown) => {
      state.calls.push({ store: "redis", op: "set", args: [key, value, opts] });
      if (state.setError) throw state.setError;
      state.lastSetToken = value;
      return state.setResult;
    },
    get: async (key: string) => {
      state.calls.push({ store: "redis", op: "get", args: [key] });
      return state.getResult ?? state.lastSetToken;
    },
    del: async (key: string) => {
      state.calls.push({ store: "redis", op: "del", args: [key] });
      return 1;
    },
  }),
}));

vi.mock("@/lib/db-admin", () => ({
  hasAdminDb: () => state.dbAvailable,
  getAdminDb: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.calls.push({ store: "db", op: fn, args: [args] });
      if (fn === "acquire_cron_lock") {
        if (state.acquireError) return { data: null, error: state.acquireError };
        return { data: state.acquireResult, error: null };
      }
      if (state.releaseError) return { data: null, error: state.releaseError };
      return { data: null, error: null };
    },
  }),
}));

import {
  acquireRedisLock,
  releaseRedisLock,
  withCronLock,
} from "@/lib/redis-lock";

function dbCalls(op: string): Call[] {
  return state.calls.filter((call) => call.store === "db" && call.op === op);
}

beforeEach(() => {
  state.redisAvailable = true;
  state.dbAvailable = true;
  state.setResult = "OK";
  state.setError = null;
  state.getResult = null;
  state.lastSetToken = null;
  state.acquireResult = true;
  state.acquireError = null;
  state.releaseError = null;
  state.calls = [];
});

describe("acquireRedisLock", () => {
  it("uses Redis when SET NX EX succeeds", async () => {
    const lock = await acquireRedisLock("lock:cron:test", 45);

    expect(lock).toMatchObject({ key: "lock:cron:test", store: "redis" });
    expect(lock?.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]).toMatchObject({ store: "redis", op: "set" });
    expect(dbCalls("acquire_cron_lock")).toHaveLength(0);
  });

  it("returns null when Redis reports the lock is already held", async () => {
    state.setResult = null;

    const lock = await acquireRedisLock("lock:cron:test", 45);

    expect(lock).toBeNull();
    // A live Redis lock must not be bypassed through the DB fallback.
    expect(dbCalls("acquire_cron_lock")).toHaveLength(0);
  });

  it("falls back to Postgres when Redis is not configured", async () => {
    state.redisAvailable = false;

    const lock = await acquireRedisLock("lock:cron:test", 45);

    expect(lock).toMatchObject({ key: "lock:cron:test", store: "db" });
    expect(state.calls.some((call) => call.store === "redis")).toBe(false);
    const [call] = dbCalls("acquire_cron_lock");
    expect(call.args[0]).toMatchObject({
      p_key: "lock:cron:test",
      p_ttl_seconds: 45,
    });
  });

  it("returns null when the Postgres lock is held by another worker", async () => {
    state.redisAvailable = false;
    state.acquireResult = false;

    const lock = await acquireRedisLock("lock:cron:test", 45);

    expect(lock).toBeNull();
  });

  it("falls back to Postgres when Redis throws", async () => {
    state.setError = new Error("redis down");

    const lock = await acquireRedisLock("lock:cron:test", 45);

    expect(lock).toMatchObject({ key: "lock:cron:test", store: "db" });
    expect(dbCalls("acquire_cron_lock")).toHaveLength(1);
  });

  it("fails closed when neither store is available", async () => {
    state.redisAvailable = false;
    state.dbAvailable = false;

    const lock = await acquireRedisLock("lock:cron:test", 45);

    expect(lock).toBeNull();
    expect(state.calls).toHaveLength(0);
  });

  it("fails closed when the Postgres RPC errors", async () => {
    state.redisAvailable = false;
    state.acquireError = { message: "relation does not exist" };

    const lock = await acquireRedisLock("lock:cron:test", 45);

    expect(lock).toBeNull();
  });
});

describe("releaseRedisLock", () => {
  it("compare-and-deletes a Redis lock", async () => {
    const lock = await acquireRedisLock("lock:cron:test", 45);
    expect(lock?.store).toBe("redis");
    state.getResult = lock!.token;
    state.calls = [];

    await releaseRedisLock(lock);

    expect(state.calls.map((call) => call.op)).toEqual(["get", "del"]);
    expect(dbCalls("release_cron_lock")).toHaveLength(0);
  });

  it("releases a Postgres lock through the RPC", async () => {
    state.redisAvailable = false;
    const lock = await acquireRedisLock("lock:cron:test", 45);
    expect(lock?.store).toBe("db");
    state.calls = [];

    await releaseRedisLock(lock);

    const [call] = dbCalls("release_cron_lock");
    expect(call.args[0]).toEqual({
      p_key: "lock:cron:test",
      p_token: lock!.token,
    });
    expect(state.calls.some((entry) => entry.store === "redis")).toBe(false);
  });

  it("never throws when release fails", async () => {
    state.redisAvailable = false;
    const lock = await acquireRedisLock("lock:cron:test", 45);
    state.releaseError = { message: "db down" };

    await expect(releaseRedisLock(lock)).resolves.toBeUndefined();
  });

  it("ignores a null lock", async () => {
    await expect(releaseRedisLock(null)).resolves.toBeUndefined();
    expect(state.calls).toHaveLength(0);
  });
});

describe("withCronLock", () => {
  it("fails closed when neither store is available", async () => {
    state.redisAvailable = false;
    state.dbAvailable = false;
    const handler = vi.fn(async () => "ran");

    const result = await withCronLock("lock:cron:test", 45, handler);

    expect(result).toEqual({ locked: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it("fails closed when Redis throws and the Postgres fallback fails", async () => {
    state.setError = new Error("redis down");
    state.dbAvailable = false;
    const handler = vi.fn(async () => "ran");

    const result = await withCronLock("lock:cron:test", 45, handler);

    expect(result).toEqual({ locked: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it("runs the handler and releases the lock when acquired", async () => {
    const handler = vi.fn(async () => "ran");

    const result = await withCronLock("lock:cron:test", 45, handler);

    expect(result).toEqual({ locked: false, value: "ran" });
    expect(handler).toHaveBeenCalledTimes(1);
    // releaseRedisLock compare-and-deletes the token it acquired.
    expect(state.calls.map((call) => call.op)).toEqual(["set", "get", "del"]);
    expect(state.calls[2].args[0]).toBe("lock:cron:test");
  });

  it("releases the lock and propagates the error when the handler throws", async () => {
    const handler = vi.fn(async () => {
      throw new Error("handler boom");
    });

    await expect(withCronLock("lock:cron:test", 45, handler)).rejects.toThrow(
      "handler boom"
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(state.calls.map((call) => call.op)).toEqual(["set", "get", "del"]);
  });
});
