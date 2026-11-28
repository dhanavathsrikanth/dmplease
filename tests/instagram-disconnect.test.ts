import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  webhookDeleteIds: [] as string[],
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

vi.mock("@/lib/profile", () => ({
  getCurrentUser: async () => ({ id: "user-1" }),
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
        eq: () => builder,
        in: () => builder,
        update: () => builder,
        delete: () => builder,
        then: (resolve: (value: unknown) => unknown) => {
          if (table === "workspaces") {
            return resolve({ data: [{ id: "ws-1" }], error: null });
          }
          if (
            table === "instagram_accounts" &&
            fields.includes("access_token")
          ) {
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

vi.mock("@/lib/db-admin", () => ({
  hasAdminDb: () => true,
  getAdminDb: () => ({
    from: (table: string) => ({
      delete: () => ({
        in: (_column: string, ids: string[]) => {
          if (table === "webhook_events") state.webhookDeleteIds = ids;
          return Promise.resolve({ error: null });
        },
      }),
    }),
  }),
}));

vi.mock("@/lib/meta/vault", () => ({
  decryptToken: () => "plain-token",
}));

vi.mock("@/lib/meta/client", () => ({
  unsubscribeInstagramAccountFromWebhooks: async () => ({ success: true }),
}));

vi.mock("@/lib/config", () => ({
  hasDatabaseUrl: () => false,
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { POST } from "@/app/api/instagram/disconnect/route";

describe("instagram disconnect", () => {
  it("purges the webhook ledger for the disconnected accounts", async () => {
    const response = await POST();

    expect(response.status).toBe(200);
    expect(state.webhookDeleteIds).toEqual(["ig-1"]);
  });
});
