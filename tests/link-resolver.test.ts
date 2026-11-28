import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  short_code: string;
  destination_url: string;
  active: boolean;
  [key: string]: unknown;
}

const state = vi.hoisted(() => ({
  redis: new Map<string, unknown>(),
  rows: new Map<string, Row>(),
  upserts: [] as Array<Record<string, unknown>>,
  dels: [] as string[],
  dbReads: 0,
}));

vi.mock("@/lib/config", () => ({
  cleanEnv: (name: string) => process.env[name] ?? "",
  getVaultSecret: () => "test-secret",
}));

vi.mock("@/lib/upstash", () => ({
  hasUpstashRedis: () => true,
  getRedis: () => ({
    get: async (key: string) => state.redis.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      state.redis.set(key, value);
      return "OK";
    },
    del: async (key: string) => {
      state.dels.push(key);
      return state.redis.delete(key) ? 1 : 0;
    },
    incr: async () => 1,
  }),
}));

vi.mock("@/lib/db-admin", () => ({
  hasAdminDb: () => true,
  getAdminDb: () => ({
    from: () => {
      const filters: Record<string, unknown> = {};
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return builder;
        },
        maybeSingle: async () => {
          state.dbReads++;
          const row = state.rows.get(String(filters.short_code)) ?? null;
          if (!row) return { data: null, error: null };
          if (filters.active === true && row.active !== true) {
            return { data: null, error: null };
          }
          return { data: { ...row }, error: null };
        },
        upsert: async (payload: Record<string, unknown>) => {
          state.upserts.push(payload);
          const code = String(payload.short_code);
          state.rows.set(code, {
            ...(state.rows.get(code) ?? {}),
            ...(payload as Row),
          });
          return { data: null, error: null };
        },
        update: (patch: Record<string, unknown>) => ({
          eq: async (column: string, value: unknown) => {
            const code = String(value);
            const row = state.rows.get(code);
            if (row) state.rows.set(code, { ...row, ...patch });
            return { data: null, error: null };
          },
        }),
      };
      return builder;
    },
  }),
}));

import {
  findTrackedLink,
  invalidateTrackedLink,
  resolveCampaignLink,
} from "@/lib/meta/link-resolver";

function seedRow(overrides: Partial<Row> = {}): Row {
  const row: Row = {
    short_code: "abc12345",
    destination_url: "https://example.com/old",
    active: true,
    ...overrides,
  };
  state.rows.set(row.short_code, row);
  return row;
}

beforeEach(() => {
  state.redis.clear();
  state.rows.clear();
  state.upserts = [];
  state.dels = [];
  state.dbReads = 0;
});

describe("loadTrackedLink cache and active state", () => {
  it("returns null for a cached inactive row without hitting the database", async () => {
    const row = seedRow({ active: false });
    state.redis.set(`shortlink:${row.short_code}`, row);

    const found = await findTrackedLink(row.short_code);

    expect(found).toBeNull();
    expect(state.dbReads).toBe(0);
  });

  it("does not cache a row that is inactive in the database", async () => {
    const row = seedRow({ active: false });

    const found = await findTrackedLink(row.short_code);

    expect(found).toBeNull();
    expect(state.redis.has(`shortlink:${row.short_code}`)).toBe(false);
  });
});

describe("invalidateTrackedLink", () => {
  it("deletes the short link cache key", async () => {
    const row = seedRow();
    state.redis.set(`shortlink:${row.short_code}`, row);

    await invalidateTrackedLink(row.short_code);

    expect(state.redis.has(`shortlink:${row.short_code}`)).toBe(false);
    expect(state.dels).toContain(`shortlink:${row.short_code}`);
  });
});

describe("getOrCreateLink destination updates", () => {
  it("keeps the short code stable and updates the destination on conflict", async () => {
    const first = await resolveCampaignLink({
      workspaceId: "ws-1",
      automationId: "auto-1",
      recipientId: "recipient-1",
      destination: "https://example.com/old",
      shortLinksEnabled: true,
    });

    const second = await resolveCampaignLink({
      workspaceId: "ws-1",
      automationId: "auto-1",
      recipientId: "recipient-1",
      destination: "https://example.com/new",
      shortLinksEnabled: true,
    });

    expect(second.shortCode).toBe(first.shortCode);
    expect(state.rows.get(first.shortCode!)?.destination_url).toBe(
      "https://example.com/new"
    );
    expect(state.upserts).toHaveLength(2);
    expect(state.upserts[1]).toMatchObject({
      short_code: first.shortCode,
      destination_url: "https://example.com/new",
      active: true,
    });
    expect(state.dels).toContain(`shortlink:${first.shortCode}`);
    expect(
      (state.redis.get(`shortlink:${first.shortCode}`) as Row).destination_url
    ).toBe("https://example.com/new");
  });

  it("reuses the cached row when the destination is unchanged", async () => {
    const first = await resolveCampaignLink({
      workspaceId: "ws-1",
      automationId: "auto-1",
      recipientId: "recipient-1",
      destination: "https://example.com/same",
      shortLinksEnabled: true,
    });
    const readsAfterFirst = state.dbReads;

    const second = await resolveCampaignLink({
      workspaceId: "ws-1",
      automationId: "auto-1",
      recipientId: "recipient-1",
      destination: "https://example.com/same",
      shortLinksEnabled: true,
    });

    expect(second.shortCode).toBe(first.shortCode);
    expect(state.upserts).toHaveLength(1);
    expect(state.dbReads).toBe(readsAfterFirst);
  });
});
