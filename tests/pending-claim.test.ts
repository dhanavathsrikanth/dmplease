import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
}));

vi.mock("@/lib/db-admin", () => ({
  hasAdminDb: () => true,
  getAdminDb: () => ({
    from: () => {
      let patch: Record<string, unknown> | null = null;
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const builder: Record<string, unknown> = {
        update: (value: Record<string, unknown>) => {
          patch = value;
          return builder;
        },
        eq: (column: string, value: unknown) => {
          filters.push((row) => row[column] === value);
          return builder;
        },
        is: (column: string, value: unknown) => {
          filters.push((row) => (row[column] ?? null) === value);
          return builder;
        },
        gt: (column: string, value: unknown) => {
          filters.push((row) => String(row[column] ?? "") > String(value));
          return builder;
        },
        select: () => builder,
        maybeSingle: () => {
          const row = [...state.rows.values()].find((candidate) =>
            filters.every((filter) => filter(candidate))
          );
          if (!row) return Promise.resolve({ data: null, error: null });
          if (patch) Object.assign(row, patch);
          return Promise.resolve({ data: { ...row }, error: null });
        },
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

const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

function seed(overrides: Record<string, unknown> = {}) {
  state.rows.set("pending-1", {
    id: "pending-1",
    workspace_id: "ws-1",
    kind: "optin",
    automation_id: null,
    rule_id: null,
    instagram_account_id: "acc-1",
    recipient_id: "user-1",
    comment_id: null,
    message: "Here is your guide",
    button_text: null,
    button_url: null,
    collect_field: null,
    expires_at: FUTURE,
    claimed_at: null,
    ...overrides,
  });
}

beforeEach(() => {
  state.rows.clear();
  seed();
});

describe("consumePending claim", () => {
  const scope = {
    workspaceId: "ws-1",
    recipientId: "user-1",
    kind: "optin",
    instagramAccountId: "acc-1",
  };

  it("returns the row once and null on a second consume", async () => {
    const first = await consumePending("pending-1", scope);
    expect(first?.id).toBe("pending-1");
    expect(state.rows.get("pending-1")?.claimed_at).toBeTruthy();

    const second = await consumePending("pending-1", scope);
    expect(second).toBeNull();
  });

  it("rejects a kind mismatch without claiming the row", async () => {
    const result = await consumePending("pending-1", { kind: "queued" });
    expect(result).toBeNull();
    expect(state.rows.get("pending-1")?.claimed_at).toBeNull();
  });

  it("rejects a recipient mismatch", async () => {
    expect(await consumePending("pending-1", { recipientId: "user-2" })).toBeNull();
    expect(state.rows.get("pending-1")?.claimed_at).toBeNull();
  });

  it("rejects an account mismatch", async () => {
    expect(
      await consumePending("pending-1", { instagramAccountId: "acc-2" })
    ).toBeNull();
    expect(state.rows.get("pending-1")?.claimed_at).toBeNull();
  });

  it("rejects a workspace mismatch", async () => {
    expect(await consumePending("pending-1", { workspaceId: "ws-2" })).toBeNull();
    expect(state.rows.get("pending-1")?.claimed_at).toBeNull();
  });

  it("rejects an expired row", async () => {
    seed({ expires_at: new Date(Date.now() - 1000).toISOString() });
    expect(await consumePending("pending-1")).toBeNull();
  });
});
