import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  filters: [] as Array<[string, string]>,
  updateFilters: [] as Array<[string, string]>,
  rows: [] as Array<Record<string, unknown>>,
  updatePayload: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/db-admin", () => ({
  hasAdminDb: () => true,
  getAdminDb: () => ({
    from: () => {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (column: string, value: string) => {
          state.filters.push([column, value]);
          return builder;
        },
        // Apply the recorded predicates so a cross-workspace id yields no row,
        // exactly like the real PostgREST query.
        limit: () =>
          Promise.resolve({
            data: state.rows.filter((row) =>
              state.filters.every(([column, value]) => row[column] === value)
            ),
            error: null,
          }),
        update: (payload: Record<string, unknown>) => {
          state.updatePayload = payload;
          const updateBuilder: Record<string, unknown> = {
            eq: (column: string, value: string) => {
              state.updateFilters.push([column, value]);
              return updateBuilder;
            },
            then: (resolve: (value: { error: null }) => unknown) =>
              Promise.resolve({ error: null }).then(resolve),
          };
          return updateBuilder;
        },
      };
      return builder;
    },
  }),
}));

vi.mock("@/lib/meta/vault", () => ({
  decryptToken: () => "plain-token",
}));

// Keep the real implementation for the unit tests, but let the admin route
// import a spy so we can assert it is never reached on a bad request.
vi.mock("@/lib/meta/profile-sync", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/meta/profile-sync")>();
  return {
    ...actual,
    syncInstagramProfile: vi.fn(actual.syncInstagramProfile),
  };
});

import { syncInstagramProfile } from "@/lib/meta/profile-sync";
import { POST as syncProfileRoute } from "@/app/api/admin/sync-profile/route";

const account = {
  id: "acc-1",
  workspace_id: "ws-1",
  instagram_id: "ig-1",
  access_token: "enc",
  is_verified: null,
  is_verified_manual: false,
};

function okProfileResponse() {
  return new Response(
    JSON.stringify({
      id: "ig-1",
      username: "real_user",
      profile_picture_url: "https://img.example/avatar.jpg",
      followers_count: 10,
    }),
    { status: 200 }
  );
}

beforeEach(() => {
  state.filters = [];
  state.updateFilters = [];
  state.rows = [];
  state.updatePayload = null;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("syncInstagramProfile", () => {
  it("scopes the account lookup by both id and workspace", async () => {
    state.rows = [account];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okProfileResponse())
    );

    await syncInstagramProfile("acc-1", "ws-1");

    expect(state.filters).toEqual([
      ["id", "acc-1"],
      ["workspace_id", "ws-1"],
    ]);
    expect(state.updatePayload).not.toBeNull();
    expect(state.updateFilters).toEqual([
      ["id", "acc-1"],
      ["workspace_id", "ws-1"],
    ]);
  });

  it("returns null and performs no update for a cross-workspace account", async () => {
    // The row exists, but it belongs to another tenant.
    state.rows = [{ ...account, workspace_id: "ws-2" }];
    const fetchMock = vi.fn(async () => okProfileResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncInstagramProfile("acc-1", "ws-1");

    expect(result).toBeNull();
    expect(state.updatePayload).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not overwrite stored fields when Meta returns a non-OK response", async () => {
    state.rows = [account];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: "expired" } }), {
          status: 400,
        })
      )
    );

    const result = await syncInstagramProfile("acc-1", "ws-1");

    expect(result).toBeNull();
    expect(state.updatePayload).toBeNull();
  });
});

describe("POST /api/admin/sync-profile", () => {
  function adminRequest(body: unknown) {
    return new NextRequest("https://app.example.com/api/admin/sync-profile", {
      method: "POST",
      headers: {
        authorization: "Bearer test-admin-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  it("returns 400 when workspaceId is missing", async () => {
    vi.stubEnv("ADMIN_API_SECRET", "test-admin-secret");

    const response = await syncProfileRoute(adminRequest({ accountId: "acc-1" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "workspaceId is required",
    });
    expect(syncInstagramProfile).not.toHaveBeenCalled();
  });
});
