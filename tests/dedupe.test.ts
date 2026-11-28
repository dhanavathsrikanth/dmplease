import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  hasDb: true,
  hasRedis: false,
  workspaceId: "ws-1" as string | null,
  claimStatus: "claimed" as string,
  claimId: "evt-1" as string | null,
  dbError: null as { message: string } | null,
  redisResult: "OK" as string | null,
  redisError: null as Error | null,
  redisKeys: [] as string[],
  rpcCalls: [] as Array<{ name: string; args: unknown }>,
}));

vi.mock("@/lib/db-admin", () => ({
  hasAdminDb: () => state.hasDb,
  getAdminDb: () => ({
    from: (table: string) => {
      if (table === "instagram_accounts") {
        return {
          select: () => ({
            eq: () => ({
              limit: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: state.workspaceId
                      ? { workspace_id: state.workspaceId }
                      : null,
                    error: null,
                  }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    rpc: (name: string, args: unknown) => {
      state.rpcCalls.push({ name, args });
      return Promise.resolve({
        data: state.dbError
          ? null
          : { status: state.claimStatus, id: state.claimId },
        error: state.dbError,
      });
    },
  }),
}));

vi.mock("@/lib/upstash", () => ({
  hasUpstashRedis: () => state.hasRedis,
  getRedis: () => ({
    set: async (key: string) => {
      state.redisKeys.push(key);
      if (state.redisError) throw state.redisError;
      return state.redisResult;
    },
  }),
}));

import { claimWebhookEvent } from "@/lib/dedupe";

const input = {
  dedupeKey: "hash-1",
  payload: { object: "instagram", entry: [] },
  object: "instagram",
  instagramAccountId: "ig-1",
  eventKind: "comments",
  externalEventId: "comment-1",
};

beforeEach(() => {
  state.hasDb = true;
  state.hasRedis = false;
  state.workspaceId = "ws-1";
  state.claimStatus = "claimed";
  state.claimId = "evt-1";
  state.dbError = null;
  state.redisResult = "OK";
  state.redisError = null;
  state.redisKeys = [];
  state.rpcCalls = [];
});

describe("claimWebhookEvent", () => {
  it("claims a new payload through the lease RPC", async () => {
    const result = await claimWebhookEvent(input);

    expect(result).toEqual({ status: "claimed", eventId: "evt-1", store: "db" });
    expect(state.rpcCalls[0]).toEqual({
      name: "claim_webhook_payload",
      args: {
        p_dedupe_key: "hash-1",
        p_object: "instagram",
        p_instagram_account_id: "ig-1",
        p_workspace_id: "ws-1",
        p_event_kind: "comments",
        p_external_event_id: "comment-1",
        p_payload: input.payload,
        p_lease_seconds: 300,
      },
    });
  });

  it("reports a completed payload as a duplicate", async () => {
    state.claimStatus = "duplicate";

    const result = await claimWebhookEvent(input);

    expect(result).toEqual({ status: "duplicate", eventId: "evt-1", store: "db" });
  });

  it("reports a live lease as in progress", async () => {
    state.claimStatus = "in_progress";

    const result = await claimWebhookEvent(input);

    expect(result).toEqual({
      status: "in_progress",
      eventId: "evt-1",
      store: "db",
    });
  });

  it("falls back to Redis when the database claim fails", async () => {
    state.dbError = { message: "connection reset" };
    state.hasRedis = true;

    const result = await claimWebhookEvent(input);

    expect(result).toEqual({ status: "claimed", eventId: null, store: "redis" });
  });

  it("reports a Redis duplicate when the key already exists", async () => {
    state.hasDb = false;
    state.hasRedis = true;
    state.redisResult = null;

    const result = await claimWebhookEvent(input);

    expect(result).toEqual({
      status: "duplicate",
      eventId: null,
      store: "redis",
    });
  });

  it("scopes the Redis key to the Instagram account", async () => {
    state.hasDb = false;
    state.hasRedis = true;

    await claimWebhookEvent(input);

    expect(state.redisKeys).toEqual(["dedupe:ig:event:ig-1:hash-1"]);
  });

  it("uses an unknown-account segment when the account id is missing", async () => {
    state.hasDb = false;
    state.hasRedis = true;

    await claimWebhookEvent({ ...input, instagramAccountId: null });

    expect(state.redisKeys).toEqual(["dedupe:ig:event:unknown:hash-1"]);
  });

  it("fails closed when neither store can claim", async () => {
    state.dbError = { message: "connection reset" };
    state.hasRedis = false;

    const result = await claimWebhookEvent(input);

    expect(result).toEqual({
      status: "unavailable",
      eventId: null,
      store: "none",
    });
  });

  it("fails closed when Redis errors and the database is unavailable", async () => {
    state.hasDb = false;
    state.hasRedis = true;
    state.redisError = new Error("redis down");

    const result = await claimWebhookEvent(input);

    expect(result).toEqual({
      status: "unavailable",
      eventId: null,
      store: "none",
    });
  });
});
