import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  upsertError: null as { message: string } | null,
  upsertPayload: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/db-admin", () => ({
  hasAdminDb: () => true,
  getAdminDb: () => ({
    from: (table: string) => ({
      upsert: (payload: Record<string, unknown>) => {
        if (table === "contacts") state.upsertPayload = payload;
        return Promise.resolve({ error: state.upsertError });
      },
      insert: () => Promise.resolve({ error: null }),
    }),
  }),
}));

vi.mock("@/lib/meta/client", () => ({}));
vi.mock("@/lib/upstash", () => ({
  hasUpstashRedis: () => false,
  getRedis: () => ({}),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { recordOptOut } from "@/lib/meta/webhook-processor";

beforeEach(() => {
  state.upsertError = null;
  state.upsertPayload = null;
});

describe("recordOptOut", () => {
  it("upserts a contact row for a first-time sender", async () => {
    await expect(recordOptOut("ws-1", "user-1", "stop")).resolves.toBe(true);

    expect(state.upsertPayload).toMatchObject({
      workspace_id: "ws-1",
      instagram_id: "user-1",
      source: "opt_out",
      opted_out_keyword: "stop",
    });
  });

  it("returns false when the upsert fails", async () => {
    state.upsertError = { message: "boom" };

    await expect(recordOptOut("ws-1", "user-1", "stop")).resolves.toBe(false);
  });
});
