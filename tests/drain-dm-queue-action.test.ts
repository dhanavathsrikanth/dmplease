import { beforeEach, describe, expect, it, vi } from "vitest";

const adminDb = { tag: "admin-db" };

const state = vi.hoisted(() => ({
  workspaces: [] as Array<{ id: string }>,
  drainCalls: [] as unknown[][],
  drainResult: {
    processed: 2,
    sent: 1,
    skipped: 1,
    failed: 0,
    remaining: 0,
    errors: [] as string[],
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "user-1" } },
        error: null,
      }),
    },
    from: (table: string) => {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        then: (resolve: (value: unknown) => unknown) =>
          resolve(
            table === "workspaces"
              ? { data: state.workspaces, error: null }
              : { data: [], error: null }
          ),
      };
      return builder;
    },
  }),
}));

vi.mock("@/lib/db-admin", () => ({
  hasAdminDb: () => true,
  getAdminDb: () => adminDb,
}));

vi.mock("@/lib/dm-queue", () => ({
  runDmQueueDrain: (...args: unknown[]) => {
    state.drainCalls.push(args);
    return Promise.resolve(state.drainResult);
  },
}));

vi.mock("@/lib/meta/account-health", () => ({
  setSafetyPaused: async () => {},
}));

import { drainDmQueueAction } from "@/app/dashboard/campaigns/actions";

beforeEach(() => {
  state.workspaces = [];
  state.drainCalls = [];
});

describe("drainDmQueueAction", () => {
  it("drains only the caller's workspaces", async () => {
    state.workspaces = [{ id: "ws-1" }, { id: "ws-2" }];

    const result = await drainDmQueueAction();

    expect(state.drainCalls).toHaveLength(1);
    expect(state.drainCalls[0]).toEqual([
      adminDb,
      { workspaceIds: ["ws-1", "ws-2"] },
    ]);
    expect(result).toEqual({ success: true, ...state.drainResult });
  });

  it("does not drain when the caller owns no workspace", async () => {
    state.workspaces = [];

    const result = await drainDmQueueAction();

    expect(state.drainCalls).toHaveLength(0);
    expect(result).toEqual({ success: false, error: "No workspace found" });
  });
});
