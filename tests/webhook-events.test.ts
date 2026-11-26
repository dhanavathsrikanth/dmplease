import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  updatePayload: null as Record<string, unknown> | null,
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/db-admin", () => ({
  hasAdminDb: () => true,
  getAdminDb: () => ({
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        state.updatePayload = payload;
        return { eq: () => Promise.resolve({ error: null }) };
      },
      select: () => ({
        gte: () => Promise.resolve({ data: state.rows, error: null }),
      }),
    }),
  }),
}));

import { getWebhookHealth, markWebhookFinished } from "@/lib/meta/webhook-events";

beforeEach(() => {
  state.updatePayload = null;
  state.rows = [];
});

describe("job ledger failure reasons", () => {
  it("stores a fallback reason when a failure has no explicit error string", async () => {
    await markWebhookFinished(
      "job-1",
      {
        events: [
          {
            kind: "comment",
            accountId: "17841428039856434",
            outcome: "failed",
            detail: "Meta error 200: request rejected",
          },
        ],
        sent: 0,
        failed: 1,
        skipped: 0,
        avgLatencyMs: null,
        errors: [],
        transientFailures: 0,
        permanentFailures: 0,
      },
      Date.now() - 100
    );

    expect(state.updatePayload?.status).toBe("FAILED");
    expect(state.updatePayload?.error).toContain("Meta error 200");
  });

  it("returns the newest failed jobs with their error details", async () => {
    state.rows = [
      {
        id: "old",
        status: "FAILED",
        duration_ms: 100,
        error: "Meta error 200",
        received_at: "2026-11-20T00:00:00.000Z",
      },
      {
        id: "new",
        status: "FAILED",
        duration_ms: 200,
        error: "Meta error 613: rate limit",
        received_at: "2026-11-26T00:00:00.000Z",
      },
      {
        id: "ok",
        status: "DONE",
        duration_ms: 50,
        error: null,
        received_at: "2026-11-26T01:00:00.000Z",
      },
    ];

    const health = await getWebhookHealth(168);

    expect(health.failed).toBe(2);
    expect(health.recentFailures.map((failure) => failure.id)).toEqual(["new", "old"]);
    expect(health.recentFailures[0].error).toBe("Meta error 613: rate limit");
  });
});
