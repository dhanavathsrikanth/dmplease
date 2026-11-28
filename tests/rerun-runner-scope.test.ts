import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/redis-lock", () => ({
  withCronLock: async (
    _key: string,
    _ttl: number,
    fn: () => Promise<unknown>
  ) => ({ locked: false, value: await fn() }),
}));

vi.mock("@/lib/upstash", () => ({
  hasQstash: () => false,
  getQstash: () => ({ publishJSON: async () => ({}) }),
  getQstashWorkerUrl: () => "https://example.com/api/workers/rerun",
}));

vi.mock("@/lib/meta/webhook-processor", () => ({
  toAutomationLike: () => null,
  processCommentEventForAutomation: async () => ({ sent: false, skipped: "test" }),
}));

import { runRerunBatch } from "@/lib/rerun-runner";

interface MockOptions {
  job: Record<string, unknown>;
  automation: Record<string, unknown> | null;
}

function makeDb(options: MockOptions) {
  const filters: Record<string, Array<[string, string]>> = {};
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = [];

  const db = {
    from(table: string) {
      const local: Array<[string, string]> = [];
      filters[table] = filters[table] ?? [];

      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (column: string, value: string) => {
          local.push([column, value]);
          filters[table].push([column, value]);
          return builder;
        },
        maybeSingle: () => {
          if (table === "rerun_jobs") {
            return Promise.resolve({ data: options.job, error: null });
          }
          if (table === "automations") {
            const automation = options.automation;
            const matches =
              automation !== null &&
              local.some(([column, value]) => column === "id" && value === automation.id) &&
              local.some(
                ([column, value]) =>
                  column === "workspace_id" && value === automation.workspace_id
              );
            return Promise.resolve({
              data: matches ? automation : null,
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        update: (payload: Record<string, unknown>) => {
          updates.push({ table, payload });
          const chain: Record<string, unknown> = {
            eq: () => chain,
            select: () => chain,
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
            then: (resolve: (value: unknown) => unknown) => resolve({ error: null }),
          };
          return chain;
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;

  return { db, filters, updates };
}

const job = {
  id: "job-1",
  workspace_id: "ws-1",
  automation_id: "auto-1",
  status: "queued",
  total: 1,
  sent: 0,
  skipped: 0,
  failed: 0,
  started_at: null,
};

describe("runRerunBatch automation scope", () => {
  it("looks up the automation by id and workspace", async () => {
    const { db, filters } = makeDb({
      job,
      automation: {
        id: "auto-1",
        workspace_id: "ws-1",
        trigger_type: "COMMENT",
        active: true,
      },
    });

    await runRerunBatch(db, "job-1");

    expect(filters.automations).toContainEqual(["id", "auto-1"]);
    expect(filters.automations).toContainEqual(["workspace_id", "ws-1"]);
  });

  it("fails the job when the automation belongs to another workspace", async () => {
    const { db, updates } = makeDb({
      job,
      automation: {
        id: "auto-1",
        workspace_id: "ws-2",
        trigger_type: "COMMENT",
        active: true,
      },
    });

    const result = await runRerunBatch(db, "job-1");

    expect(result.status).toBe("failed");
    expect(updates).toContainEqual({
      table: "rerun_jobs",
      payload: {
        status: "failed",
        error_message: "Campaign no longer exists in this workspace",
        finished_at: expect.any(String),
      },
    });
  });
});
