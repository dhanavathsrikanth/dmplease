import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  updatePayload: null as Record<string, unknown> | null,
  summary: {} as Record<string, unknown>,
  failures: [] as Array<Record<string, unknown>>,
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
}));

vi.mock("@/lib/db-admin", () => ({
  hasAdminDb: () => true,
  getAdminDb: () => ({
    from: (table: string) => ({
      update: (payload: Record<string, unknown>) => {
        state.updatePayload = payload;
        return { eq: () => Promise.resolve({ error: null }) };
      },
      select: () => ({
        in: (...args: unknown[]) => {
          state.calls.push({ table, method: "in", args });
          return {
            eq: () => ({
              gte: () => ({
                order: () => ({
                  limit: () =>
                    Promise.resolve({ data: state.failures, error: null }),
                }),
              }),
            }),
          };
        },
      }),
    }),
    rpc: (name: string, args: unknown) => {
      state.calls.push({ table: `rpc:${name}`, method: "rpc", args: [args] });
      return Promise.resolve({ data: state.summary, error: null });
    },
  }),
}));

import { getWebhookHealth, markWebhookFinished, markWebhookProcessing } from "@/lib/meta/webhook-events";

beforeEach(() => {
  state.updatePayload = null;
  state.summary = {};
  state.failures = [];
  state.calls = [];
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

  it("stores delivery counts and the first skip reason for analytics", async () => {
    await markWebhookFinished(
      "job-1",
      {
        events: [
          {
            kind: "comment",
            accountId: "17841428039856434",
            outcome: "skipped",
            detail: "Already messaged in 24h",
          },
          {
            kind: "comment",
            accountId: "17841428039856434",
            outcome: "sent",
          },
        ],
        sent: 1,
        failed: 0,
        skipped: 1,
        avgLatencyMs: 120,
        errors: [],
        transientFailures: 0,
        permanentFailures: 0,
      },
      Date.now() - 100
    );

    expect(state.updatePayload).toMatchObject({
      status: "DONE",
      sent_count: 1,
      skipped_count: 1,
      failed_count: 0,
      skip_reason: "Already messaged in 24h",
      lease_expires_at: null,
    });
  });

  it("extends the lease while processing", async () => {
    await markWebhookProcessing("job-1", "qstash");

    expect(state.updatePayload).toMatchObject({
      status: "PROCESSING",
      source: "qstash",
    });
    expect(typeof state.updatePayload?.lease_expires_at).toBe("string");
  });

  it("returns the aggregate and the newest failed jobs", async () => {
    state.summary = {
      total: 10,
      done: 7,
      failed: 2,
      pending: 1,
      duplicates: 4,
      sent: 12,
      skipped: 3,
      avgDurationMs: 145.6,
      topSkipReasons: [
        { reason: "Recipient cooldown (10 min per post)", count: 2 },
      ],
    };
    state.failures = [
      {
        id: "new",
        error: "Meta error 613: rate limit",
        received_at: "2026-11-26T00:00:00.000Z",
      },
      {
        id: "old",
        error: "Meta error 200",
        received_at: "2026-11-20T00:00:00.000Z",
      },
    ];

    const health = await getWebhookHealth(168, ["ws-1"]);

    expect(health).toMatchObject({
      total: 10,
      done: 7,
      failed: 2,
      pending: 1,
      duplicates: 4,
      sent: 12,
      skipped: 3,
      successRate: 78,
      avgDurationMs: 146,
      available: true,
    });
    expect(health.recentFailures.map((failure) => failure.id)).toEqual([
      "new",
      "old",
    ]);
    expect(health.topSkipReasons).toEqual([
      { reason: "Recipient cooldown (10 min per post)", count: 2 },
    ]);
  });

  it("scopes the aggregate and failure reads to the caller's workspaces", async () => {
    await getWebhookHealth(168, ["ws-1", "ws-2"]);

    expect(state.calls).toContainEqual({
      table: "rpc:webhook_health",
      method: "rpc",
      args: [
        {
          p_workspace_ids: ["ws-1", "ws-2"],
          p_since: expect.any(String),
        },
      ],
    });
    expect(state.calls).toContainEqual({
      table: "webhook_events",
      method: "in",
      args: ["workspace_id", ["ws-1", "ws-2"]],
    });
  });

  it("returns empty health without querying when the caller has no workspaces", async () => {
    const health = await getWebhookHealth(168, []);

    expect(health.available).toBe(false);
    expect(health.total).toBe(0);
    expect(state.calls).toEqual([]);
  });
});
