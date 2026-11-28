import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const dbState = vi.hoisted(() => ({
  selects: [] as string[],
}));

const patchState = vi.hoisted(() => ({
  updateTable: null as string | null,
  updatePayload: null as Record<string, unknown> | null,
  updateFilter: null as { column: string; values: unknown } | null,
}));

vi.mock("@/lib/db-admin", () => ({
  hasAdminDb: () => true,
  getAdminDb: () => ({
    from: (table: string) => {
      const builder: Record<string, unknown> = {
        select: (fields?: string) => {
          if (fields) dbState.selects.push(`${table}:${fields}`);
          return builder;
        },
        eq: () => builder,
        gte: () => builder,
        limit: () => builder,
        maybeSingle: () =>
          Promise.resolve({
            data:
              table === "report_links"
                ? { workspace_id: "ws-1", enabled: true, revoked_at: null }
                : table === "workspaces"
                  ? { name: "Acme" }
                  : null,
            error: null,
          }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null, count: 0 }).then(resolve),
      };
      return builder;
    },
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1" } } }),
    },
    from: (table: string) => {
      if (table === "workspaces") {
        const builder: Record<string, unknown> = {
          select: () => builder,
          eq: () => Promise.resolve({ data: [{ id: "ws-1" }], error: null }),
        };
        return builder;
      }
      return {
        update: (payload: Record<string, unknown>) => {
          patchState.updateTable = table;
          patchState.updatePayload = payload;
          return {
            in: async (column: string, values: unknown) => {
              patchState.updateFilter = { column, values };
              return { error: null };
            },
          };
        },
      };
    },
  }),
}));

import { loadPublicReport, summarizePublicReport } from "@/lib/public-report";
import { PATCH } from "@/app/api/instagram/profile/route";

beforeEach(() => {
  dbState.selects = [];
  patchState.updateTable = null;
  patchState.updatePayload = null;
  patchState.updateFilter = null;
});

describe("is_verified_manual is owner-only", () => {
  it("is absent from the public report payload", async () => {
    const report = await loadPublicReport("report-token", 30);

    expect(report).not.toBeNull();
    expect(JSON.stringify(report)).not.toContain("is_verified_manual");
    expect(
      dbState.selects.some((entry) => entry.includes("is_verified_manual"))
    ).toBe(false);
  });

  it("is absent from the pure report summary", () => {
    const report = summarizePublicReport({
      workspaceName: "Acme",
      days: 30,
      reportKey: "report-token",
      dms: [],
      clicks: [],
      conversions: [],
      comments: 0,
      leads: 0,
      automations: [],
      accounts: [{ id: "acc-1", username: "acme" }],
    });

    expect(JSON.stringify(report)).not.toContain("is_verified_manual");
  });

  it("still lets the owner set the manual badge on their own account", async () => {
    const request = new NextRequest(
      "https://app.example.com/api/instagram/profile",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isVerifiedManual: true }),
      }
    );

    const response = await PATCH(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(patchState.updateTable).toBe("instagram_accounts");
    expect(patchState.updatePayload).toMatchObject({ is_verified_manual: true });
    expect(patchState.updateFilter).toEqual({
      column: "workspace_id",
      values: ["ws-1"],
    });
  });
});
