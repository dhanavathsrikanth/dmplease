import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  deletes: [] as Array<{ table: string; column: string; cutoff: string }>,
}));

vi.mock("@/lib/followups", () => ({
  isCronAuthorized: () => true,
}));

vi.mock("@/lib/db-admin", () => ({
  hasAdminDb: () => true,
  getAdminDb: () => ({
    from: (table: string) => ({
      delete: () => ({
        lt: async (column: string, cutoff: string) => {
          state.deletes.push({ table, column, cutoff });
          return { error: null, count: 0 };
        },
      }),
    }),
  }),
}));

import { POST } from "@/app/api/cron/safety-retention/route";

const DAY_MS = 24 * 60 * 60 * 1000;

function request(): NextRequest {
  return new NextRequest("https://app.example.com/api/cron/safety-retention", {
    method: "POST",
    headers: { authorization: "Bearer test" },
  });
}

beforeEach(() => {
  state.deletes = [];
});

describe("safety retention windows", () => {
  it("keeps safety_events for 90 days to match the documented audit window", async () => {
    const before = Date.now();
    const response = await POST(request());
    const after = Date.now();

    expect(response.status).toBe(200);
    const rule = state.deletes.find((entry) => entry.table === "safety_events");
    expect(rule).toBeDefined();
    expect(rule?.column).toBe("created_at");

    const cutoff = new Date(rule!.cutoff).getTime();
    expect(cutoff).toBeGreaterThanOrEqual(before - 90 * DAY_MS - 1000);
    expect(cutoff).toBeLessThanOrEqual(after - 90 * DAY_MS + 1000);
  });

  it("still prunes webhook_events at 30 days", async () => {
    await POST(request());

    const rule = state.deletes.find((entry) => entry.table === "webhook_events");
    expect(rule).toBeDefined();
    const cutoff = new Date(rule!.cutoff).getTime();
    expect(cutoff).toBeGreaterThan(Date.now() - 31 * DAY_MS);
    expect(cutoff).toBeLessThan(Date.now() - 29 * DAY_MS);
  });
});
