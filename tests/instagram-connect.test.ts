import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

interface MetaAccount {
  instagramBusinessId: string;
  username: string;
  displayName: string;
  followersCount: number;
  pageToken: string | null;
  facebookPageId: string | null;
}

const state = vi.hoisted(() => ({
  upserts: [] as Array<{ table: string; payload: Record<string, unknown> }>,
  prismaUpserts: [] as Array<{ create: Record<string, unknown> }>,
  subscribeCalls: [] as Array<{ target: string; token: string }>,
  subscribeResult: { success: true } as { success: boolean },
  subscribeThrows: false,
  hasDatabaseUrl: false,
  accounts: [] as MetaAccount[],
}));

function defaultAccounts(): MetaAccount[] {
  return [
    {
      instagramBusinessId: "ig-1",
      username: "real_user",
      displayName: "Real User",
      followersCount: 10,
      pageToken: "page-token",
      facebookPageId: null,
    },
  ];
}

vi.mock("@/lib/profile", () => ({
  getCurrentUser: async () => ({ id: "user-1" }),
  getCurrentProfile: async () => ({ ownedWorkspaces: [{ id: "ws-1" }] }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      let fields = "";
      const builder: Record<string, unknown> = {
        select: (value?: string) => {
          fields = value ?? "";
          return builder;
        },
        in: () => builder,
        limit: () => builder,
        eq: () => builder,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        single: () => Promise.resolve({ data: { id: "ws-new" }, error: null }),
        insert: () => builder,
        upsert: (payload: Record<string, unknown>) => {
          state.upserts.push({ table, payload });
          return Promise.resolve({ error: null });
        },
        then: (resolve: (value: unknown) => unknown) => {
          if (table === "instagram_accounts" && fields.includes("access_token")) {
            return resolve({
              data: [{ instagram_id: "ig-1", access_token: "enc" }],
              error: null,
            });
          }
          return resolve({ data: [], error: null });
        },
      };
      return builder;
    },
  }),
}));

vi.mock("@/lib/meta/vault", () => ({
  decryptToken: (value: string) => (value === "enc" ? "source-token" : value),
  encryptToken: (value: string) => `enc:${value}`,
}));

vi.mock("@/lib/meta/client", () => ({
  fetchInstagramAccountsForToken: async () => state.accounts,
  subscribeInstagramAccountToWebhooks: async (target: string, token: string) => {
    state.subscribeCalls.push({ target, token });
    if (state.subscribeThrows) throw new Error("Meta subscribe exploded");
    return state.subscribeResult;
  },
}));

vi.mock("@/lib/config", () => ({
  hasDatabaseUrl: () => state.hasDatabaseUrl,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    instagramAccount: {
      upsert: async (args: { create: Record<string, unknown> }) => {
        state.prismaUpserts.push(args);
        return args.create;
      },
    },
  },
}));

import { POST } from "@/app/api/instagram/accounts/connect/route";

function request(body: unknown) {
  return new NextRequest(
    "https://app.example.com/api/instagram/accounts/connect",
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }
  );
}

function connectBody() {
  return {
    accounts: [{ instagramBusinessId: "ig-1", username: "spoofed" }],
  };
}

function instagramUpsert() {
  return state.upserts.find((u) => u.table === "instagram_accounts");
}

beforeEach(() => {
  state.upserts = [];
  state.prismaUpserts = [];
  state.subscribeCalls = [];
  state.subscribeResult = { success: true };
  state.subscribeThrows = false;
  state.hasDatabaseUrl = false;
  state.accounts = defaultAccounts();
});

describe("instagram connect legacy path", () => {
  it("uses Meta metadata instead of the request body", async () => {
    const response = await POST(request(connectBody()));

    expect(response.status).toBe(200);
    const upsert = instagramUpsert();
    expect(upsert?.payload.username).toBe("real_user");
    expect(upsert?.payload.instagram_id).toBe("ig-1");
  });

  it("rejects an account the source token does not control", async () => {
    const response = await POST(
      request({
        accounts: [{ instagramBusinessId: "ig-victim", username: "victim" }],
      })
    );

    expect(response.status).toBe(403);
    expect(
      state.upserts.filter((u) => u.table === "instagram_accounts")
    ).toHaveLength(0);
  });
});

describe("instagram connect webhook subscription state", () => {
  it("stores webhook_subscribed: true when the subscription succeeds", async () => {
    state.subscribeResult = { success: true };

    const response = await POST(request(connectBody()));

    expect(response.status).toBe(200);
    expect(instagramUpsert()?.payload.webhook_subscribed).toBe(true);
  });

  it("stores webhook_subscribed: false when the subscription fails", async () => {
    state.subscribeResult = { success: false };

    const response = await POST(request(connectBody()));

    expect(response.status).toBe(200);
    expect(instagramUpsert()?.payload.webhook_subscribed).toBe(false);
  });

  it("treats a thrown subscription call as a failure", async () => {
    state.subscribeThrows = true;

    const response = await POST(request(connectBody()));

    expect(response.status).toBe(200);
    expect(instagramUpsert()?.payload.webhook_subscribed).toBe(false);
  });

  it("mirrors the subscription state into the Prisma account", async () => {
    state.hasDatabaseUrl = true;
    state.subscribeResult = { success: false };

    await POST(request(connectBody()));

    expect(state.prismaUpserts).toHaveLength(1);
    expect(state.prismaUpserts[0]?.create.webhookSubscribed).toBe(false);
  });

  it("subscribes the Facebook page when the account has one", async () => {
    state.accounts[0]!.facebookPageId = "page-1";

    await POST(request(connectBody()));

    expect(state.subscribeCalls).toHaveLength(1);
    expect(state.subscribeCalls[0]?.target).toBe("page-1");
  });

  it("falls back to the Instagram business id without a Facebook page", async () => {
    state.accounts[0]!.facebookPageId = null;

    await POST(request(connectBody()));

    expect(state.subscribeCalls).toHaveLength(1);
    expect(state.subscribeCalls[0]?.target).toBe("ig-1");
  });
});
