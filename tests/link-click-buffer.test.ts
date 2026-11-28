import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  lpush: [] as Array<{ key: string; value: string }>,
  ltrim: [] as Array<{ key: string; start: number; stop: number }>,
  llen: 0,
  failLpush: false,
  failLtrim: false,
}));

vi.mock("@/lib/config", () => ({
  cleanEnv: (name: string) => process.env[name] ?? "",
  getVaultSecret: () => "test-secret",
}));

vi.mock("@/lib/upstash", () => ({
  hasUpstashRedis: () => true,
  getRedis: () => ({
    lpush: async (key: string, value: string) => {
      if (state.failLpush) throw new Error("redis down");
      state.lpush.push({ key, value });
      return state.lpush.length;
    },
    llen: async () => state.llen,
    ltrim: async (key: string, start: number, stop: number) => {
      if (state.failLtrim) throw new Error("trim failed");
      state.ltrim.push({ key, start, stop });
      return "OK";
    },
  }),
}));

vi.mock("@/lib/db-admin", () => ({
  hasAdminDb: () => true,
  getAdminDb: () => ({
    from: () => ({
      upsert: async () => ({ error: { message: "database unavailable" } }),
    }),
  }),
}));

import {
  MAX_BUFFER,
  recordTrackedLinkClick,
} from "@/lib/meta/link-resolver";

const link = {
  id: "link-1",
  workspace_id: "11111111-1111-4111-8111-111111111111",
  automation_id: null,
  rotator_id: null,
  target_id: null,
  contact_id: null,
  short_code: "abc12345",
  destination_url: "https://example.com/offer",
  label: null,
  post_id: null,
  keyword: null,
  sequence_step: null,
  active: true,
};

function click(eventId = "evt-1") {
  return recordTrackedLinkClick({
    link,
    referrer: null,
    userAgent: "Mozilla/5.0",
    eventId,
  });
}

beforeEach(() => {
  state.lpush = [];
  state.ltrim = [];
  state.llen = 0;
  state.failLpush = false;
  state.failLtrim = false;
});

describe("recordTrackedLinkClick buffer cap", () => {
  it("pushes the click and trims the buffer to MAX_BUFFER", async () => {
    const stored = await click();

    expect(stored).toBe(true);
    expect(state.lpush).toHaveLength(1);
    expect(state.lpush[0].key).toBe("link_clicks:buffer");
    expect(state.ltrim).toEqual([
      { key: "link_clicks:buffer", start: 0, stop: MAX_BUFFER - 1 },
    ]);
  });

  it("warns when the buffer exceeds the cap before trimming", async () => {
    state.llen = MAX_BUFFER + 25;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const stored = await click();

    expect(stored).toBe(true);
    expect(state.ltrim).toEqual([
      { key: "link_clicks:buffer", start: 0, stop: MAX_BUFFER - 1 },
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`exceeded ${MAX_BUFFER}`)
    );
  });

  it("still returns true when the trim fails after a successful push", async () => {
    state.failLtrim = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const stored = await click();

    expect(stored).toBe(true);
    expect(state.lpush).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(
      "[tracking] Could not trim click buffer:",
      expect.any(Error)
    );
  });

  it("returns false when Redis cannot buffer the click", async () => {
    state.failLpush = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const stored = await click();

    expect(stored).toBe(false);
    expect(state.ltrim).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(
      "[tracking] Could not buffer click:",
      expect.any(Error)
    );
  });
});
