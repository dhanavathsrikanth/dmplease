import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  account: {
    id: "acc-db-1",
    workspace_id: "ws-real",
    access_token: "encrypted-token",
    token_status: "valid",
  },
}));

vi.mock("@/lib/db-admin", () => ({
  hasAdminDb: () => true,
  getAdminDb: () => ({
    from: (table: string) => {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        limit: () => builder,
        maybeSingle: () =>
          Promise.resolve({
            data: table === "instagram_accounts" ? state.account : null,
            error: null,
          }),
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

import { processCommentEventForAutomation } from "@/lib/meta/webhook-processor";

const commentEvent = {
  instagramAccountId: "ig-1",
  commentId: "c-1",
  commentText: "send me the guide",
  commenterId: "u-1",
  mediaId: "m-1",
};

describe("comment campaign workspace binding", () => {
  it("rejects a campaign whose workspace does not own the account", async () => {
    const result = await processCommentEventForAutomation(commentEvent, {
      id: "auto-1",
      workspaceId: "ws-other",
      name: "Cross-tenant campaign",
      triggerType: "COMMENT",
      triggerKeywords: ["guide"],
      dmMessage: "Here is your guide",
    });

    expect(result).toEqual({
      sent: false,
      skipped: "Campaign workspace mismatch",
    });
  });
});
