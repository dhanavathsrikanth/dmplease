import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  calls: [] as Array<{
    table: string;
    select?: string;
    eq?: [string, unknown];
    limit?: number;
  }>,
  limiterSuccess: true,
  limiterReset: 0,
  fetchCalls: [] as string[],
}));

vi.mock("@/lib/config", () => ({
  getAdminApiSecret: () => process.env.ADMIN_API_SECRET?.trim() || "",
  getCronSecret: () => process.env.CRON_SECRET?.trim() || "",
}));

vi.mock("@/lib/db-admin", () => {
  function builder(table: string) {
    const call: {
      table: string;
      select?: string;
      eq?: [string, unknown];
      limit?: number;
    } = { table };

    const api = {
      select(columns: string) {
        call.select = columns;
        return api;
      },
      eq(column: string, value: unknown) {
        call.eq = [column, value];
        return api;
      },
      limit(count: number) {
        call.limit = count;
        return api;
      },
      then(
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown
      ) {
        state.calls.push(call);
        let rows = state.rows;
        if (call.eq) {
          const [column, value] = call.eq;
          rows = rows.filter((row) => row[column] === value);
        }
        if (call.limit !== undefined) rows = rows.slice(0, call.limit);
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };

    return api;
  }

  return {
    hasAdminDb: () => true,
    getAdminDb: () => ({ from: (table: string) => builder(table) }),
  };
});

vi.mock("@/lib/meta/vault", () => ({
  decryptToken: () => "EAAB  decrypted-token\nwith whitespace",
}));

vi.mock("@/lib/upstash", () => ({
  getRateLimiterFor: () => ({
    limit: async () => ({
      success: state.limiterSuccess,
      reset: state.limiterReset,
      remaining: 0,
      limit: 2,
    }),
  }),
}));

import { GET } from "@/app/api/diagnostics/meta-token/route";

const ACCOUNT_A = {
  id: "11111111-1111-4111-8111-111111111111",
  instagram_id: "17841400000000001",
  username: "alpha",
  access_token: "enc:tag:cipher",
  token_status: "active",
};

const ACCOUNT_B = {
  id: "22222222-2222-4222-8222-222222222222",
  instagram_id: "17841400000000002",
  username: "beta",
  access_token: "enc:tag:cipher",
  token_status: "active",
};

function request(query = "", secret = "admin-secret") {
  return new NextRequest(
    `https://app.example.com/api/diagnostics/meta-token${query}`,
    { method: "GET", headers: { authorization: `Bearer ${secret}` } }
  );
}

/** Every object key in a JSON value, recursively. */
function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      collectKeys(child, keys);
    }
  }
  return keys;
}

beforeEach(() => {
  state.rows = [ACCOUNT_A, ACCOUNT_B];
  state.calls = [];
  state.limiterSuccess = true;
  state.limiterReset = Date.now() + 3_600_000;
  state.fetchCalls = [];

  vi.stubEnv("ADMIN_API_SECRET", "admin-secret");
  vi.stubEnv("CRON_SECRET", "cron-secret");
  vi.stubEnv("META_APP_ID", "app-id");
  vi.stubEnv("META_APP_SECRET", "app-secret");

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      state.fetchCalls.push(String(input));
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { is_valid: true, scopes: ["instagram_basic"] } }),
      };
    })
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GET /api/diagnostics/meta-token", () => {
  it("never discloses token length or whitespace", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);

    const text = await response.text();
    const body = JSON.parse(text) as Record<string, unknown>;

    expect(text).not.toContain("token_meta");
    expect(text).not.toContain("decrypted-token");
    expect(collectKeys(body)).not.toContain("length");
    expect(collectKeys(body)).not.toContain("whitespace");
    expect(body.accounts).toHaveLength(2);
  });

  it("rejects CRON_SECRET and accepts ADMIN_API_SECRET", async () => {
    const rejected = await GET(request("", "cron-secret"));
    expect(rejected.status).toBe(401);
    expect(rejected.headers.get("Cache-Control")).toBe("no-store");

    const accepted = await GET(request("", "admin-secret"));
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns 429 when the rate limiter rejects the call", async () => {
    state.limiterSuccess = false;
    state.limiterReset = Date.now() + 60_000;

    const response = await GET(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    const body = (await response.json()) as {
      error: string;
      retryAfterMs: number;
    };
    expect(body.error).toBe("Rate limited");
    expect(body.retryAfterMs).toBeGreaterThan(0);

    // A rejected call must not reach the database or the Graph API.
    expect(state.calls).toHaveLength(0);
    expect(state.fetchCalls).toHaveLength(0);
  });

  it("probes only the requested account when accountId is supplied", async () => {
    const response = await GET(request(`?accountId=${ACCOUNT_B.id}`));
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      accounts: Array<{ username: string }>;
    };
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0].username).toBe("beta");

    // The query is scoped by primary key and capped at one row.
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]).toMatchObject({
      table: "instagram_accounts",
      eq: ["id", ACCOUNT_B.id],
      limit: 1,
    });

    // One app-credential check plus ten probes for the single account.
    expect(state.fetchCalls).toHaveLength(11);
    expect(state.fetchCalls.some((url) => url.includes(ACCOUNT_A.instagram_id))).toBe(
      false
    );
  });

  it("caps the default fan-out at three accounts", async () => {
    state.rows = [
      ACCOUNT_A,
      ACCOUNT_B,
      { ...ACCOUNT_A, id: "33333333-3333-4333-8333-333333333333", username: "gamma" },
      { ...ACCOUNT_A, id: "44444444-4444-4444-8444-444444444444", username: "delta" },
    ];

    const response = await GET(request());
    expect(response.status).toBe(200);

    const body = (await response.json()) as { accounts: unknown[] };
    expect(body.accounts).toHaveLength(3);
    expect(state.calls[0]).toMatchObject({ limit: 3 });
    expect(state.calls[0].eq).toBeUndefined();
  });

  it("rejects a malformed accountId without touching the database", async () => {
    const response = await GET(request("?accountId=not-a-uuid"));
    expect(response.status).toBe(400);
    expect(state.calls).toHaveLength(0);
  });
});
