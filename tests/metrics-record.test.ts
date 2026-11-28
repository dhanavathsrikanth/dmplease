import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  keys: [] as string[],
}));

vi.mock("@/lib/upstash", () => ({
  hasUpstashRedis: () => true,
  getRedis: () => ({
    pipeline: () => ({
      incr: (key: string) => {
        state.keys.push(key);
        return {};
      },
      incrby: (key: string) => {
        state.keys.push(key);
        return {};
      },
      expire: () => ({}),
      sadd: () => ({}),
      exec: async () => [],
    }),
  }),
}));

vi.mock("@/lib/timezone", () => ({
  getDayKey: () => "2026-11-27",
}));

import { recordMetricEvent } from "@/lib/metrics";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  state.keys = [];
});

describe("recordMetricEvent", () => {
  it("coerces a non-UUID target id to the workspace id", async () => {
    await recordMetricEvent({
      kind: "dm_sent",
      creatorId: WORKSPACE_ID,
      targetId: "manual",
    });

    expect(state.keys).toEqual([
      `metric:2026-11-27:dm_sent:${WORKSPACE_ID}:${WORKSPACE_ID}`,
    ]);
  });

  it("keeps a valid UUID target id", async () => {
    await recordMetricEvent({
      kind: "dm_sent",
      creatorId: WORKSPACE_ID,
      targetId: TARGET_ID,
    });

    expect(state.keys).toEqual([
      `metric:2026-11-27:dm_sent:${WORKSPACE_ID}:${TARGET_ID}`,
    ]);
  });

  it("ignores an event with a non-UUID creator id", async () => {
    await recordMetricEvent({
      kind: "dm_sent",
      creatorId: "creator-1",
      targetId: TARGET_ID,
    });

    expect(state.keys).toEqual([]);
  });
});
