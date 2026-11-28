import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const CRON_SECRET = "test-cron-secret";
const RAW_DB_ERROR =
  'relation "instagram_accounts" does not exist (SQLSTATE 42P01)';

const state = vi.hoisted(() => ({
  dbError: null as { message: string } | null,
  refreshed: [] as string[][],
}));

// `connection()` throws outside a real Next request scope, so stub it out.
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, connection: async () => undefined };
});

vi.mock("@/lib/config", () => ({
  getCronSecret: () => CRON_SECRET,
}));

vi.mock("@/lib/redis-lock", () => ({
  withCronLock: async (
    _key: string,
    _ttl: number,
    handler: () => Promise<unknown>
  ) => ({ locked: false, value: await handler() }),
}));

vi.mock("@/lib/meta/insights-sync", () => ({
  refreshInsightsForWorkspaces: async (workspaceIds: string[]) => {
    state.refreshed.push(workspaceIds);
    return { accounts: 0, points: 0, media: 0, needsAccess: 0, errors: [] };
  },
}));

vi.mock("@/lib/db-admin", () => ({
  hasAdminDb: () => true,
  getAdminDb: () => ({
    from: () => {
      const builder = {
        select: () => builder,
        not: async () => ({ data: null, error: state.dbError }),
      };
      return builder;
    },
  }),
}));

import { GET } from "@/app/api/cron/insights/route";

function call(secret = CRON_SECRET) {
  return GET(
    new NextRequest("https://app.example.com/api/cron/insights", {
      headers: { authorization: `Bearer ${secret}` },
    })
  );
}

beforeEach(() => {
  state.dbError = null;
  state.refreshed = [];
});

describe("insights cron route", () => {
  it("returns a generic error and hides database details", async () => {
    state.dbError = { message: RAW_DB_ERROR };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await call();

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json).toEqual({ error: "Insights cron failed" });
    expect(JSON.stringify(json)).not.toContain(RAW_DB_ERROR);
    expect(JSON.stringify(json)).not.toContain("SQLSTATE");
    expect(errorSpy).toHaveBeenCalled();
  });

  it("still reports success when the database query works", async () => {
    const response = await call();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true });
  });

  it("rejects a request without the cron secret", async () => {
    const response = await call("wrong-secret");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });
});
