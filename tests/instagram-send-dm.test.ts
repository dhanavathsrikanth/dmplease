import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const WS_2 = "11111111-1111-4111-8111-111111111111";
const FOREIGN_WS = "22222222-2222-4222-8222-222222222222";

interface AccountRow {
  id: string;
  instagram_id: string;
  access_token: string;
  username: string;
}

const state = vi.hoisted(() => ({
  hasDb: true,
  dedupeRow: null as { id: string } | null,
  dedupeError: null as { message: string } | null,
  adminCalls: [] as Array<{ table: string; method: string; args: unknown[] }>,
  sendCalls: [] as unknown[][],
  sendResult: { message_id: "mid-1" } as {
    message_id?: string;
    error?: { message: string };
  },
  workspaces: [
    { id: "ws-1", owner_id: "user-1" },
    { id: "11111111-1111-4111-8111-111111111111", owner_id: "user-1" },
    { id: "22222222-2222-4222-8222-222222222222", owner_id: "user-2" },
  ] as Array<{ id: string; owner_id: string }>,
  accounts: {
    "ws-1": {
      id: "acc-1",
      instagram_id: "ig-1",
      access_token: "enc-token",
      username: "creator",
    },
    "11111111-1111-4111-8111-111111111111": {
      id: "acc-2",
      instagram_id: "ig-2",
      access_token: "enc-token-2",
      username: "creator-two",
    },
  } as Record<string, AccountRow>,
  limiterCalls: [] as Array<{ key: string; cap: number }>,
  limiterResults: {} as Record<
    string,
    { allowed: boolean; remaining: number; retryAfterMs: number }
  >,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
    },
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      let limitCount: number | null = null;
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return builder;
        },
        limit: (count: number) => {
          limitCount = count;
          return builder;
        },
        maybeSingle: () => {
          if (table === "workspaces") {
            const workspace = state.workspaces.find(
              (row) => row.id === filters.id && row.owner_id === filters.owner_id
            );
            return Promise.resolve({
              data: workspace ? { id: workspace.id } : null,
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        then: (resolve: (value: unknown) => unknown) => {
          if (table === "workspaces") {
            const owned = state.workspaces.filter(
              (row) => row.owner_id === filters.owner_id
            );
            const limited =
              limitCount === null ? owned : owned.slice(0, limitCount);
            return resolve({
              data: limited.map((row) => ({ id: row.id })),
              error: null,
            });
          }
          if (table === "instagram_accounts") {
            const account = state.accounts[String(filters.workspace_id)];
            return resolve({ data: account ? [account] : [], error: null });
          }
          return resolve({ data: [], error: null });
        },
      };
      return builder;
    },
  }),
}));

vi.mock("@/lib/db-admin", () => ({
  hasAdminDb: () => state.hasDb,
  getAdminDb: () => ({
    from: (table: string) => {
      let isNullFilter = false;
      const builder: Record<string, unknown> = {
        select: (...args: unknown[]) => {
          state.adminCalls.push({ table, method: "select", args });
          return builder;
        },
        eq: (...args: unknown[]) => {
          state.adminCalls.push({ table, method: "eq", args });
          return builder;
        },
        is: (...args: unknown[]) => {
          state.adminCalls.push({ table, method: "is", args });
          isNullFilter = true;
          return builder;
        },
        gte: (...args: unknown[]) => {
          state.adminCalls.push({ table, method: "gte", args });
          return builder;
        },
        limit: (...args: unknown[]) => {
          state.adminCalls.push({ table, method: "limit", args });
          return builder;
        },
        maybeSingle: () => {
          state.adminCalls.push({ table, method: "maybeSingle", args: [] });
          if (table === "dm_logs" && isNullFilter) {
            return Promise.resolve({
              data: state.dedupeRow,
              error: state.dedupeError,
            });
          }
          if (table === "contacts") {
            return Promise.resolve({ data: { id: "contact-1" }, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        single: () => Promise.resolve({ data: { id: "conv-1" }, error: null }),
        insert: (payload: unknown) => {
          state.adminCalls.push({ table, method: "insert", args: [payload] });
          return Promise.resolve({ error: null });
        },
        upsert: (payload: unknown, options?: unknown) => {
          state.adminCalls.push({ table, method: "upsert", args: [payload, options] });
          return builder;
        },
        update: (payload: unknown) => {
          state.adminCalls.push({ table, method: "update", args: [payload] });
          return builder;
        },
      };
      return builder;
    },
  }),
}));

vi.mock("@/lib/meta/vault", () => ({
  decryptToken: () => "plain-token",
}));

vi.mock("@/lib/meta/client", () => ({
  sendDirectMessage: async (...args: unknown[]) => {
    state.sendCalls.push(args);
    return state.sendResult;
  },
}));

vi.mock("@/lib/meta/safety", () => ({
  acquireSendSlot: async (key: string, cap: number) => {
    state.limiterCalls.push({ key, cap });
    const override = state.limiterResults[key];
    if (override) return { mode: "local", ...override };
    return { allowed: true, remaining: 10, retryAfterMs: 0, mode: "local" };
  },
  checkRecipientCooldown: async () => true,
}));

vi.mock("@/lib/meta/webhook-processor", () => ({
  ensureContact: async () => "contact-1",
}));

vi.mock("@/lib/meta/account-health", () => ({
  recordSendOutcome: async () => ({}),
}));

vi.mock("@/lib/metrics", () => ({
  isUuid: (value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    ),
  recordMetricEvent: async () => undefined,
}));

vi.mock("@/lib/workspace-preferences", () => ({
  getWorkspaceTimeZone: async () => "UTC",
}));

import { POST } from "@/app/api/instagram/send-dm/route";
import { ACCOUNT_HOURLY_CEILING } from "@/lib/meta/limits";

function request(body: unknown) {
  return new NextRequest("https://app.example.com/api/instagram/send-dm", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const validBody = {
  recipientId: "igsid-1",
  recipientUsername: "someone",
  message: "hello there",
};

function dedupeCalls() {
  return state.adminCalls.filter(
    (call) => call.table === "dm_logs" && call.method !== "insert"
  );
}

function insertFor(table: string) {
  return state.adminCalls.find(
    (call) => call.table === table && call.method === "insert"
  );
}

function upsertFor(table: string) {
  return state.adminCalls.find(
    (call) => call.table === table && call.method === "upsert"
  );
}

beforeEach(() => {
  state.hasDb = true;
  state.dedupeRow = null;
  state.dedupeError = null;
  state.adminCalls = [];
  state.sendCalls = [];
  state.sendResult = { message_id: "mid-1" };
  state.limiterCalls = [];
  state.limiterResults = {};
});

describe("POST /api/instagram/send-dm 24h dedupe", () => {
  it("scopes the dedupe query with .is(automation_id, null) and tenant filters", async () => {
    const response = await POST(request(validBody));

    expect(response.status).toBe(200);

    const calls = dedupeCalls();
    expect(calls).toContainEqual({
      table: "dm_logs",
      method: "is",
      args: ["automation_id", null],
    });
    expect(calls).toContainEqual({
      table: "dm_logs",
      method: "eq",
      args: ["workspace_id", "ws-1"],
    });
    expect(calls).toContainEqual({
      table: "dm_logs",
      method: "eq",
      args: ["instagram_account_id", "acc-1"],
    });
    expect(calls).toContainEqual({
      table: "dm_logs",
      method: "eq",
      args: ["recipient_id", "igsid-1"],
    });
    // The old broken shape must not come back.
    expect(calls).not.toContainEqual({
      table: "dm_logs",
      method: "eq",
      args: ["automation_id", null],
    });
  });

  it("returns 503 and does not send when the dedupe query errors", async () => {
    state.dedupeError = { message: "connection reset" };

    const response = await POST(request(validBody));

    expect(response.status).toBe(503);
    const body = (await response.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/could not verify recent sends/i);
    expect(state.sendCalls).toHaveLength(0);
  });

  it("returns 409 and does not send when a recent dm_logs row exists", async () => {
    state.dedupeRow = { id: "log-1" };

    const response = await POST(request(validBody));

    expect(response.status).toBe(409);
    const body = (await response.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/already messaged/i);
    expect(state.sendCalls).toHaveLength(0);
  });

  it("proceeds to sendDirectMessage when the dedupe query is clean", async () => {
    const response = await POST(request(validBody));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; messageId: string };
    expect(body).toEqual({ success: true, messageId: "mid-1" });
    expect(state.sendCalls).toHaveLength(1);
    expect(state.sendCalls[0]).toEqual([
      "plain-token",
      "ig-1",
      "igsid-1",
      expect.any(String),
    ]);
  });
});

describe("POST /api/instagram/send-dm workspace selection", () => {
  it("uses the workspaceId from the body for the account and every write", async () => {
    const response = await POST(request({ ...validBody, workspaceId: WS_2 }));

    expect(response.status).toBe(200);
    expect(state.sendCalls).toHaveLength(1);
    // The second workspace's account sends, not the first owned one.
    expect(state.sendCalls[0]).toEqual([
      "plain-token",
      "ig-2",
      "igsid-1",
      expect.any(String),
    ]);

    expect(dedupeCalls()).toContainEqual({
      table: "dm_logs",
      method: "eq",
      args: ["workspace_id", WS_2],
    });
    expect(dedupeCalls()).toContainEqual({
      table: "dm_logs",
      method: "eq",
      args: ["instagram_account_id", "acc-2"],
    });

    expect(upsertFor("conversations")?.args[0]).toMatchObject({
      workspace_id: WS_2,
      instagram_account_id: "acc-2",
    });
    expect(insertFor("messages")?.args[0]).toMatchObject({
      workspace_id: WS_2,
    });
    expect(insertFor("dm_logs")?.args[0]).toMatchObject({
      workspace_id: WS_2,
      instagram_account_id: "acc-2",
    });
  });

  it("returns 403 and does not send for a workspace owned by someone else", async () => {
    const response = await POST(request({ ...validBody, workspaceId: FOREIGN_WS }));

    expect(response.status).toBe(403);
    const body = (await response.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/workspace not found or access denied/i);
    expect(state.sendCalls).toHaveLength(0);
    expect(state.limiterCalls).toHaveLength(0);
    expect(state.adminCalls).toHaveLength(0);
  });

  it("returns 403 for a malformed workspaceId", async () => {
    const response = await POST(request({ ...validBody, workspaceId: "not-a-uuid" }));

    expect(response.status).toBe(403);
    expect(state.sendCalls).toHaveLength(0);
  });
});

describe("POST /api/instagram/send-dm rate limiting", () => {
  it("charges the shared account bucket before the manual cap", async () => {
    const response = await POST(request(validBody));

    expect(response.status).toBe(200);
    expect(state.limiterCalls).toEqual([
      { key: "ig-1:account", cap: ACCOUNT_HOURLY_CEILING },
      { key: "ig-1:manual", cap: 30 },
    ]);
  });

  it("returns 429 without sending when the account ceiling is reached", async () => {
    state.limiterResults["ig-1:account"] = {
      allowed: false,
      remaining: 0,
      retryAfterMs: 120_000,
    };

    const response = await POST(request(validBody));

    expect(response.status).toBe(429);
    const body = (await response.json()) as {
      success: boolean;
      error: string;
      retryAfterMs: number;
    };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/account hourly ceiling/i);
    expect(body.retryAfterMs).toBe(120_000);
    expect(state.sendCalls).toHaveLength(0);
    // The manual bucket is never charged once the shared ceiling rejects.
    expect(state.limiterCalls).toEqual([
      { key: "ig-1:account", cap: ACCOUNT_HOURLY_CEILING },
    ]);
  });

  it("returns 429 without sending when the manual cap is exhausted", async () => {
    state.limiterResults["ig-1:manual"] = {
      allowed: false,
      remaining: 0,
      retryAfterMs: 60_000,
    };

    const response = await POST(request(validBody));

    expect(response.status).toBe(429);
    const body = (await response.json()) as {
      success: boolean;
      error: string;
      retryAfterMs: number;
    };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/manual dm limit/i);
    expect(body.retryAfterMs).toBe(60_000);
    expect(state.sendCalls).toHaveLength(0);
  });
});
