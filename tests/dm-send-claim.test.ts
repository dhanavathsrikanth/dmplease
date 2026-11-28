import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  hasDb: true,
  claimResult: true as boolean | null,
  claimError: null as { message: string; code?: string } | null,
  calls: [] as Array<{ name: string; args: unknown }>,
}));

vi.mock("@/lib/db-admin", () => ({
  hasAdminDb: () => state.hasDb,
  getAdminDb: () => ({
    rpc: (name: string, args: unknown) => {
      state.calls.push({ name, args });
      if (name === "claim_dm_send") {
        return Promise.resolve({ data: state.claimResult, error: state.claimError });
      }
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

import { claimDmSend, releaseDmSend } from "@/lib/dm-send-claim";

const input = {
  workspaceId: "ws-1",
  automationId: "auto-1",
  instagramAccountId: "acc-1",
  recipientId: "user-1",
};

beforeEach(() => {
  state.hasDb = true;
  state.claimResult = true;
  state.claimError = null;
  state.calls = [];
});

describe("claimDmSend", () => {
  it("claims the send atomically", async () => {
    const claimed = await claimDmSend(input);

    expect(claimed).toBe(true);
    expect(state.calls[0]).toEqual({
      name: "claim_dm_send",
      args: {
        p_workspace_id: "ws-1",
        p_automation_id: "auto-1",
        p_instagram_account_id: "acc-1",
        p_recipient_id: "user-1",
        p_ttl_seconds: 600,
      },
    });
  });

  it("skips when another delivery holds the claim", async () => {
    state.claimResult = false;

    const claimed = await claimDmSend(input);

    expect(claimed).toBe(false);
  });

  it("fails closed on a real database error", async () => {
    state.claimError = { message: "connection reset" };

    const claimed = await claimDmSend(input);

    expect(claimed).toBe(false);
  });

  it("continues during a rolling deploy when the RPC is missing", async () => {
    state.claimError = { message: "function does not exist", code: "42883" };

    const claimed = await claimDmSend(input);

    expect(claimed).toBe(true);
  });

  it("continues when no database is configured", async () => {
    state.hasDb = false;

    const claimed = await claimDmSend(input);

    expect(claimed).toBe(true);
    expect(state.calls).toEqual([]);
  });
});

describe("releaseDmSend", () => {
  it("releases the claim after a definitive rejection", async () => {
    await releaseDmSend({ automationId: "auto-1", recipientId: "user-1" });

    expect(state.calls).toEqual([
      {
        name: "release_dm_send",
        args: { p_automation_id: "auto-1", p_recipient_id: "user-1" },
      },
    ]);
  });
});
