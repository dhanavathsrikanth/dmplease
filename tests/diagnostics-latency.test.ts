import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The diagnostics page is reachable by every signed-in user, so the Meta
 * latency probe must be cached: one outbound Graph API request per five
 * minutes, not one per page load.
 */

const redisState = vi.hoisted(() => ({
  available: false,
  store: new Map<string, unknown>(),
  sets: [] as Array<{ key: string; value: unknown; options: unknown }>,
}));

vi.mock("@/lib/upstash", () => ({
  hasUpstashRedis: () => redisState.available,
  getRedis: () => ({
    get: async (key: string) => redisState.store.get(key) ?? null,
    set: async (key: string, value: unknown, options: unknown) => {
      redisState.sets.push({ key, value, options });
      redisState.store.set(key, value);
      return "OK";
    },
  }),
}));

const FIVE_MINUTES_MS = 5 * 60 * 1000;

function okFetch() {
  return vi.fn(async () => ({ ok: true, status: 200 }));
}

async function loadClient() {
  return import("@/lib/meta/client");
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  redisState.available = false;
  redisState.store.clear();
  redisState.sets = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("checkMetaApiLatency caching", () => {
  it("reuses the result for five minutes without calling fetch again", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);

    const { checkMetaApiLatency } = await loadClient();

    const first = await checkMetaApiLatency();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.status).toBe("operational");

    // Four minutes later: still inside the window.
    vi.advanceTimersByTime(4 * 60 * 1000);
    const second = await checkMetaApiLatency();

    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes the probe once the five-minute TTL has elapsed", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);

    const { checkMetaApiLatency } = await loadClient();

    await checkMetaApiLatency();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(FIVE_MINUTES_MS + 1);
    const refreshed = await checkMetaApiLatency();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshed.status).toBe("operational");
  });

  it("caches an offline probe too, so an outage is not hammered", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchMock);

    const { checkMetaApiLatency } = await loadClient();

    const first = await checkMetaApiLatency();
    expect(first.status).toBe("offline");

    vi.advanceTimersByTime(60 * 1000);
    const second = await checkMetaApiLatency();

    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shares the cached result through Redis across instances", async () => {
    redisState.available = true;
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);

    const first = await loadClient();
    const result = await first.checkMetaApiLatency();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(redisState.sets).toHaveLength(1);
    expect(redisState.sets[0].key).toBe("meta:api-latency");
    expect(redisState.sets[0].options).toEqual({ ex: 300 });

    // A fresh module instance (another serverless invocation) must read Redis
    // instead of probing Meta again.
    vi.resetModules();
    const second = await loadClient();
    const cached = await second.checkMetaApiLatency();

    expect(cached).toEqual(result);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
