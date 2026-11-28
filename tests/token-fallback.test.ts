import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  updates: [] as Array<{ table: string; payload: Record<string, unknown> }>,
}));

vi.mock("@/lib/db-admin", () => ({
  hasAdminDb: () => true,
  getAdminDb: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          limit: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data:
                  table === "instagram_accounts"
                    ? {
                        id: "acc-1",
                        workspace_id: "ws-1",
                        access_token: null,
                        token_status: null,
                      }
                    : null,
                error: null,
              }),
          }),
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        state.updates.push({ table, payload });
        return { eq: () => Promise.resolve({ error: null }) };
      },
      insert: () => Promise.resolve({ error: null }),
    }),
  }),
}));

vi.mock("@/lib/meta/client", () => ({}));
vi.mock("@/lib/upstash", () => ({
  hasUpstashRedis: () => false,
  getRedis: () => ({}),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { processCommentEventForAutomation } from "@/lib/meta/webhook-processor";

afterEach(() => {
  vi.unstubAllEnvs();
  state.updates = [];
});

describe("getToken fail-closed", () => {
  it("skips the send when the account has no stored token", async () => {
    const result = await processCommentEventForAutomation(
      {
        instagramAccountId: "ig-1",
        commentId: "c-1",
        commentText: "hi",
        commenterId: "u-1",
        mediaId: "m-1",
      },
      {
        id: "a-1",
        workspaceId: "ws-1",
        triggerType: "COMMENT",
        triggerKeywords: ["hi"],
        dmMessage: "Hello",
      }
    );

    expect(result.sent).toBe(false);
    expect(result.skipped).toBe("No valid access token");
  });

  it("does not fall back to INSTAGRAM_ACCESS_TOKEN when the account token is null", async () => {
    vi.stubEnv("INSTAGRAM_ACCESS_TOKEN", "process-wide-fallback-token");

    const result = await processCommentEventForAutomation(
      {
        instagramAccountId: "ig-1",
        commentId: "c-1",
        commentText: "hi",
        commenterId: "u-1",
        mediaId: "m-1",
      },
      {
        id: "a-1",
        workspaceId: "ws-1",
        triggerType: "COMMENT",
        triggerKeywords: ["hi"],
        dmMessage: "Hello",
      }
    );

    expect(result.sent).toBe(false);
    expect(result.skipped).toBe("No valid access token");
  });

  it("marks the account invalid when the token is missing", async () => {
    await processCommentEventForAutomation(
      {
        instagramAccountId: "ig-1",
        commentId: "c-1",
        commentText: "hi",
        commenterId: "u-1",
        mediaId: "m-1",
      },
      {
        id: "a-1",
        workspaceId: "ws-1",
        triggerType: "COMMENT",
        triggerKeywords: ["hi"],
        dmMessage: "Hello",
      }
    );

    const accountUpdate = state.updates.find(
      (entry) => entry.table === "instagram_accounts"
    );
    expect(accountUpdate?.payload.token_status).toBe("invalid");
  });
});
