import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  filters: [] as Array<[string, string]>,
}));

vi.mock("@/lib/db-admin", () => ({
  hasAdminDb: () => true,
  getAdminDb: () => ({
    from: () => {
      const builder: Record<string, unknown> = {
        update: () => builder,
        select: () => builder,
        eq: (column: string, value: string) => {
          state.filters.push([column, value]);
          return builder;
        },
        is: () => builder,
        gt: () => builder,
        limit: () => builder,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      };
      return builder;
    },
  }),
}));

vi.mock("@/lib/meta/client", () => ({}));
vi.mock("@/lib/upstash", () => ({
  hasUpstashRedis: () => false,
  getRedis: () => ({}),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { consumePending } from "@/lib/meta/webhook-processor";

beforeEach(() => {
  state.filters = [];
});

describe("consumePending", () => {
  it("scopes the lookup by workspace and recipient", async () => {
    await consumePending("pending-1", {
      workspaceId: "ws-1",
      recipientId: "user-1",
    });

    expect(state.filters).toContainEqual(["workspace_id", "ws-1"]);
    expect(state.filters).toContainEqual(["recipient_id", "user-1"]);
  });

  it("does not add tenant filters when no scope is provided", async () => {
    await consumePending("pending-1");

    expect(state.filters).toEqual([["id", "pending-1"]]);
  });
});
