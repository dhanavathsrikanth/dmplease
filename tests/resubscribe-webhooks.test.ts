import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

interface Row {
  id: string;
  instagram_id: string;
  access_token: string;
  webhook_subscribed: boolean;
}

interface FakeBuilder {
  select: (columns?: string) => FakeBuilder;
  not: (column: string, operator: string, value: unknown) => FakeBuilder;
  order: (column: string, options?: { ascending?: boolean }) => FakeBuilder;
  limit: (value: number) => Promise<{
    data: Row[];
    error: { message: string } | null;
  }>;
  update: (payload: Record<string, unknown>) => {
    eq: (column: string, value: string) => Promise<{ error: null }>;
  };
}

const state = vi.hoisted(() => ({
  adminDbAvailable: true,
  rows: [] as Row[],
  updates: [] as Array<{ id: string; payload: Record<string, unknown> }>,
  subscribeCalls: [] as Array<{ accountId: string; token: string }>,
  subscribeResults: {} as Record<string, boolean>,
  decryptFailures: [] as string[],
  lastLimit: 0,
  selectError: null as { message: string } | null,
}));

vi.mock("@/lib/config", () => ({
  getAdminApiSecret: () => "admin-secret",
}));

vi.mock("@/lib/db-admin", () => ({
  hasAdminDb: () => state.adminDbAvailable,
  getAdminDb: () => ({
    from: () => {
      const builder: FakeBuilder = {
        select: () => builder,
        not: () => builder,
        order: () => builder,
        limit: (value: number) => {
          state.lastLimit = value;
          return Promise.resolve({ data: state.rows, error: state.selectError });
        },
        update: (payload: Record<string, unknown>) => ({
          eq: (column: string, value: string) => {
            state.updates.push({ id: value, payload });
            return Promise.resolve({ error: null });
          },
        }),
      };
      return builder;
    },
  }),
}));

vi.mock("@/lib/meta/vault", () => ({
  decryptToken: (value: string) => {
    if (state.decryptFailures.includes(value)) {
      throw new Error("Unable to decrypt token");
    }
    return `plain:${value}`;
  },
}));

vi.mock("@/lib/meta/client", () => ({
  subscribeInstagramAccountToWebhooks: async (
    accountId: string,
    token: string
  ) => {
    state.subscribeCalls.push({ accountId, token });
    return { success: state.subscribeResults[accountId] ?? true };
  },
}));

import { POST } from "@/app/api/admin/resubscribe-webhooks/route";

function post(body?: unknown, secret = "admin-secret"): NextRequest {
  return new NextRequest(
    "https://app.example.com/api/admin/resubscribe-webhooks",
    {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }
  );
}

function row(id: string, instagramId: string, accessToken: string): Row {
  return {
    id,
    instagram_id: instagramId,
    access_token: accessToken,
    webhook_subscribed: true,
  };
}

beforeEach(() => {
  state.adminDbAvailable = true;
  state.rows = [];
  state.updates = [];
  state.subscribeCalls = [];
  state.subscribeResults = {};
  state.decryptFailures = [];
  state.lastLimit = 0;
  state.selectError = null;
});

describe("admin resubscribe-webhooks auth", () => {
  it("rejects a missing admin secret with 401", async () => {
    const response = await POST(post(undefined, ""));

    expect(response.status).toBe(401);
    expect(state.lastLimit).toBe(0);
  });

  it("rejects a wrong admin secret with 401", async () => {
    const response = await POST(post(undefined, "not-the-secret"));

    expect(response.status).toBe(401);
    expect(state.lastLimit).toBe(0);
  });

  it("returns 503 when the admin DB is unavailable", async () => {
    state.adminDbAvailable = false;

    const response = await POST(post());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Admin DB unavailable" });
  });
});

describe("admin resubscribe-webhooks backfill", () => {
  it("re-subscribes rows and writes the real subscription result", async () => {
    state.rows = [row("row-1", "ig-1", "enc-1"), row("row-2", "ig-2", "enc-2")];
    state.subscribeResults = { "ig-2": false };

    const response = await POST(post());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      scanned: 2,
      subscribed: 1,
      failed: 1,
    });
    expect(state.subscribeCalls).toEqual([
      { accountId: "ig-1", token: "plain:enc-1" },
      { accountId: "ig-2", token: "plain:enc-2" },
    ]);
    expect(state.updates).toHaveLength(2);
    expect(state.updates[0]).toMatchObject({
      id: "row-1",
      payload: { webhook_subscribed: true },
    });
    expect(state.updates[1]).toMatchObject({
      id: "row-2",
      payload: { webhook_subscribed: false },
    });
    expect(state.updates[0].payload.updated_at).toEqual(expect.any(String));
  });

  it("counts a decrypt failure as failed without calling Meta", async () => {
    state.rows = [row("row-1", "ig-1", "bad-token")];
    state.decryptFailures = ["bad-token"];

    const response = await POST(post());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      scanned: 1,
      subscribed: 0,
      failed: 1,
    });
    expect(state.subscribeCalls).toEqual([]);
    // The row is moved to the back of the queue and marked unsubscribed so one
    // undecryptable token cannot block every later batch.
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]).toMatchObject({
      id: "row-1",
      payload: { webhook_subscribed: false },
    });
    expect(state.updates[0].payload.updated_at).toEqual(expect.any(String));
  });

  it("defaults the limit to 50", async () => {
    await POST(post());

    expect(state.lastLimit).toBe(50);
  });

  it("clamps the limit to 100", async () => {
    await POST(post({ limit: 500 }));

    expect(state.lastLimit).toBe(100);
  });

  it("clamps the limit to at least 1", async () => {
    await POST(post({ limit: 0 }));

    expect(state.lastLimit).toBe(1);
  });
});
