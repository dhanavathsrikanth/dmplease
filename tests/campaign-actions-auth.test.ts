import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  authError: null as { message: string } | null,
  campaign: { id: "campaign-1", workspace_id: "ws-1" } as {
    id: string;
    workspace_id: string;
  } | null,
  ownedWorkspace: { id: "ws-1" } as { id: string } | null,
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

vi.mock("@/lib/supabase/server", () => {
  function makeBuilder(table: string) {
    const builder: Record<string, unknown> = {
      select: (...args: unknown[]) => {
        state.calls.push({ table, method: "select", args });
        return builder;
      },
      eq: (...args: unknown[]) => {
        state.calls.push({ table, method: "eq", args });
        return builder;
      },
      maybeSingle: () => {
        state.calls.push({ table, method: "maybeSingle", args: [] });
        if (table === "automations") {
          return Promise.resolve({ data: state.campaign, error: null });
        }
        if (table === "workspaces") {
          return Promise.resolve({ data: state.ownedWorkspace, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      update: (...args: unknown[]) => {
        state.calls.push({ table, method: "update", args });
        return builder;
      },
      delete: (...args: unknown[]) => {
        state.calls.push({ table, method: "delete", args });
        return builder;
      },
      then: (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown
      ) => Promise.resolve({ data: null, error: null }).then(resolve, reject),
    };
    return builder;
  }

  return {
    createClient: async () => ({
      auth: {
        getUser: async () => ({
          data: { user: state.user },
          error: state.authError,
        }),
      },
      from: (table: string) => makeBuilder(table),
    }),
  };
});

vi.mock("@/lib/db-admin", () => ({
  hasAdminDb: () => true,
  getAdminDb: () => ({}),
}));

vi.mock("@/lib/dm-queue", () => ({
  runDmQueueDrain: async () => ({}),
}));

vi.mock("@/lib/meta/account-health", () => ({
  setSafetyPaused: async () => {},
}));

import {
  deleteCampaign,
  toggleCampaignActive,
} from "@/app/dashboard/campaigns/actions";

function writes() {
  return state.calls.filter(
    (call) => call.method === "update" || call.method === "delete"
  );
}

beforeEach(() => {
  state.user = { id: "user-1" };
  state.authError = null;
  state.campaign = { id: "campaign-1", workspace_id: "ws-1" };
  state.ownedWorkspace = { id: "ws-1" };
  state.calls = [];
});

describe("toggleCampaignActive ownership", () => {
  it("rejects an unauthenticated caller without updating", async () => {
    state.user = null;

    const result = await toggleCampaignActive("campaign-1", false);

    expect(result).toEqual({ success: false, error: "Not authenticated" });
    expect(writes()).toHaveLength(0);
  });

  it("rejects a campaign in a workspace the caller does not own", async () => {
    state.ownedWorkspace = null;

    const result = await toggleCampaignActive("campaign-1", false);

    expect(result).toEqual({
      success: false,
      error: "Not authorized to edit this campaign",
    });
    expect(writes()).toHaveLength(0);
  });

  it("updates the campaign when the caller owns the workspace", async () => {
    const result = await toggleCampaignActive("campaign-1", false);

    expect(result).toEqual({ success: true });
    const updates = writes();
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      table: "automations",
      method: "update",
    });
    expect(updates[0].args[0]).toMatchObject({ active: false });
  });
});

describe("deleteCampaign ownership", () => {
  it("rejects an unauthenticated caller without deleting", async () => {
    state.user = null;

    const result = await deleteCampaign("campaign-1");

    expect(result).toEqual({ success: false, error: "Not authenticated" });
    expect(writes()).toHaveLength(0);
  });

  it("rejects a campaign in a workspace the caller does not own", async () => {
    state.ownedWorkspace = null;

    const result = await deleteCampaign("campaign-1");

    expect(result).toEqual({
      success: false,
      error: "Not authorized to edit this campaign",
    });
    expect(writes()).toHaveLength(0);
  });

  it("deletes the campaign when the caller owns the workspace", async () => {
    const result = await deleteCampaign("campaign-1");

    expect(result).toEqual({ success: true });
    const deletes = writes();
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toMatchObject({
      table: "automations",
      method: "delete",
    });
  });
});
