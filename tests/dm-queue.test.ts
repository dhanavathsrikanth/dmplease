import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  id: string;
  workspace_id: string;
  automation_id: string | null;
  instagram_account_id: string | null;
  recipient_id: string;
  comment_id: string;
  attempts: number;
  status: string;
}

interface FakeState {
  batchRows: Row[];
  commentEvents: Array<Record<string, unknown>>;
  automations: Array<Record<string, unknown>>;
  accounts: Array<Record<string, unknown>>;
  moreRows: Array<{ id: string }>;
  rpcError: { message: string } | null;
  lockKeys: string[];
  calls: Array<{
    table: string;
    op: string;
    filters: Array<[string, unknown]>;
    payload?: unknown;
  }>;
}

const state = vi.hoisted<FakeState>(() => ({
  batchRows: [],
  commentEvents: [],
  automations: [],
  accounts: [],
  moreRows: [],
  rpcError: null,
  lockKeys: [],
  calls: [],
}));

const processMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db-admin", () => ({
  hasAdminDb: () => true,
  getAdminDb: () => makeDb(),
}));

vi.mock("@/lib/redis-lock", () => ({
  withCronLock: async (
    key: string,
    _ttl: number,
    fn: () => Promise<unknown>
  ) => {
    state.lockKeys.push(key);
    return { locked: false, value: await fn() };
  },
}));

vi.mock("@/lib/meta/webhook-processor", () => ({
  toAutomationLike: (row: Record<string, unknown>) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    triggerType: row.trigger_type,
    triggerKeywords: row.trigger_keywords ?? [],
    dmMessage: row.dm_message ?? "",
  }),
  processCommentEventForAutomation: processMock,
}));

vi.mock("@/lib/upstash", () => ({
  getQstash: () => ({ publishJSON: async () => ({}) }),
  hasQstash: () => false,
}));

function matches(
  row: Record<string, unknown>,
  filters: Array<[string, unknown]>
): boolean {
  return filters.every(([column, value]) => {
    if (column.startsWith("in:")) {
      const key = column.slice(3);
      return Array.isArray(value) && value.includes(row[key]);
    }
    if (column.startsWith("lte:")) {
      const key = column.slice(4);
      return String(row[key] ?? "") <= String(value);
    }
    return row[column] === value;
  });
}

function makeDb() {
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    let op = "select";
    let payload: unknown;

    const resolveList = () => {
      state.calls.push({ table, op, filters: [...filters], payload });
      if (table === "pending_dms" && op === "select") {
        // The batch query has a limit; the existence check is a separate call.
        return { data: state.batchRows, error: null };
      }
      if (table === "pending_dms" && op === "update") {
        return { data: null, error: null };
      }
      if (table === "pending_dms" && op === "delete") {
        return { data: null, error: null };
      }
      return { data: [], error: null };
    };

    const resolveSingle = () => {
      state.calls.push({ table, op, filters: [...filters], payload });
      if (table === "pending_dms" && op === "update") {
        const row = state.batchRows.find((candidate) =>
          matches(candidate as unknown as Record<string, unknown>, filters)
        );
        return { data: row ? { id: row.id } : null, error: null };
      }
      if (table === "comment_events") {
        const row = state.commentEvents.find((candidate) =>
          matches(candidate, filters)
        );
        return { data: row ?? null, error: null };
      }
      if (table === "automations") {
        const row = state.automations.find((candidate) =>
          matches(candidate, filters)
        );
        return { data: row ?? null, error: null };
      }
      if (table === "instagram_accounts") {
        const row = state.accounts.find((candidate) =>
          matches(candidate, filters)
        );
        return { data: row ?? null, error: null };
      }
      return { data: null, error: null };
    };

    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return builder;
      },
      in: (column: string, value: unknown) => {
        filters.push([`in:${column}`, value]);
        return builder;
      },
      lte: (column: string, value: unknown) => {
        filters.push([`lte:${column}`, value]);
        return builder;
      },
      gt: () => builder,
      order: () => builder,
      limit: (count: number) => {
        if (table === "pending_dms" && op === "select" && count === 1) {
          // The existence check is the only select with limit(1) after the
          // batch query has already been recorded.
          const isBatch = state.calls.some(
            (call) => call.table === "pending_dms" && call.op === "select"
          );
          if (isBatch) {
            state.calls.push({ table, op, filters: [...filters], payload });
            return Promise.resolve({ data: state.moreRows, error: null });
          }
        }
        return builder;
      },
      maybeSingle: () => Promise.resolve(resolveSingle()),
      single: () => Promise.resolve(resolveSingle()),
      update: (value: unknown) => {
        op = "update";
        payload = value;
        return builder;
      },
      delete: () => {
        op = "delete";
        return builder;
      },
      insert: (value: unknown) => {
        op = "insert";
        payload = value;
        return builder;
      },
      upsert: (value: unknown) => {
        op = "upsert";
        payload = value;
        return builder;
      },
      then: (resolve: (value: unknown) => unknown) =>
        resolve(resolveList()),
    };
    return builder;
  };

  return {
    from,
    rpc: async (name: string, args: unknown) => {
      state.calls.push({ table: `rpc:${name}`, op: "rpc", filters: [], payload: args });
      return { data: null, error: state.rpcError };
    },
  };
}

import { enqueueQueuedDm, runDmQueueDrain } from "@/lib/dm-queue";

const queuedRow: Row = {
  id: "p1",
  workspace_id: "ws-a",
  automation_id: "auto-b",
  instagram_account_id: "acc-a",
  recipient_id: "user-1",
  comment_id: "comment-1",
  attempts: 0,
  status: "pending",
};

beforeEach(() => {
  state.batchRows = [];
  state.commentEvents = [];
  state.automations = [];
  state.accounts = [];
  state.moreRows = [];
  state.rpcError = null;
  state.lockKeys = [];
  state.calls = [];
  processMock.mockReset();
  processMock.mockResolvedValue({ sent: true });
});

describe("runDmQueueDrain tenant binding", () => {
  it("does not render another tenant's automation", async () => {
    state.batchRows = [queuedRow];
    state.commentEvents = [
      {
        workspace_id: "ws-a",
        external_id: "comment-1",
        instagram_account_id: "acc-a",
        media_id: "media-1",
        commenter_id: "user-1",
        commenter_username: "user",
        text: "hi",
      },
    ];
    // The automation exists, but belongs to ws-b.
    state.automations = [
      {
        id: "auto-b",
        workspace_id: "ws-b",
        trigger_type: "COMMENT",
        dm_message: "Victim copy",
      },
    ];
    state.accounts = [
      {
        id: "acc-a",
        workspace_id: "ws-a",
        instagram_id: "ig-a",
        access_token: "enc",
      },
    ];

    const result = await runDmQueueDrain(makeDb() as never);

    expect(processMock).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
    expect(result.sent).toBe(0);

    const automationCall = state.calls.find(
      (call) => call.table === "automations"
    );
    expect(automationCall?.filters).toContainEqual(["workspace_id", "ws-a"]);
  });

  it("sends when the automation belongs to the row's workspace", async () => {
    state.batchRows = [queuedRow];
    state.commentEvents = [
      {
        workspace_id: "ws-a",
        external_id: "comment-1",
        instagram_account_id: "acc-a",
        media_id: "media-1",
        commenter_id: "user-1",
        commenter_username: "user",
        text: "hi",
      },
    ];
    state.automations = [
      {
        id: "auto-b",
        workspace_id: "ws-a",
        trigger_type: "COMMENT",
        dm_message: "Own copy",
      },
    ];
    state.accounts = [
      {
        id: "acc-a",
        workspace_id: "ws-a",
        instagram_id: "ig-a",
        access_token: "enc",
      },
    ];

    const result = await runDmQueueDrain(makeDb() as never);

    expect(processMock).toHaveBeenCalledTimes(1);
    expect(result.sent).toBe(1);
  });

  it("scopes the batch and the existence check to the caller's workspaces", async () => {
    state.batchRows = [];
    state.moreRows = [];

    await runDmQueueDrain(makeDb() as never, { workspaceIds: ["ws-a"] });

    const pendingSelects = state.calls.filter(
      (call) => call.table === "pending_dms" && call.op === "select"
    );
    expect(pendingSelects.length).toBeGreaterThanOrEqual(2);
    for (const call of pendingSelects) {
      expect(call.filters).toContainEqual(["in:workspace_id", ["ws-a"]]);
    }
  });

  it("returns immediately for an empty workspace scope", async () => {
    const result = await runDmQueueDrain(makeDb() as never, {
      workspaceIds: [],
    });

    expect(result).toEqual({
      processed: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      remaining: 0,
      errors: [],
    });
    expect(state.calls).toHaveLength(0);
  });

  it("reports remaining as a bounded existence flag, not a global count", async () => {
    state.batchRows = [];
    state.moreRows = [{ id: "p2" }];

    const result = await runDmQueueDrain(makeDb() as never);

    expect(result.remaining).toBe(1);
    const existenceCall = state.calls.find(
      (call) =>
        call.table === "pending_dms" &&
        call.op === "select" &&
        call.filters.some(([column]) => column === "lte:next_attempt_at")
    );
    expect(existenceCall).toBeDefined();
  });

  it("uses a tenant-scoped lock so a manual drain cannot block the worker", async () => {
    await runDmQueueDrain(makeDb() as never, { workspaceIds: ["ws-b", "ws-a"] });
    await runDmQueueDrain(makeDb() as never);

    expect(state.lockKeys).toEqual([
      "dmplease:dmqueue:drain:ws-a,ws-b",
      "dmplease:dmqueue:drain",
    ]);
  });
});

describe("enqueueQueuedDm", () => {
  it("uses the atomic partial-index RPC", async () => {
    await enqueueQueuedDm({
      workspaceId: "ws-a",
      automationId: "auto-a",
      instagramAccountId: "acc-a",
      recipientId: "user-1",
      commentId: "comment-1",
      message: "Hello",
      buttonText: "Open",
      buttonUrl: "https://example.com",
    });

    const call = state.calls.find((entry) => entry.table === "rpc:enqueue_queued_dm");
    expect(call?.payload).toEqual({
      p_workspace_id: "ws-a",
      p_automation_id: "auto-a",
      p_instagram_account_id: "acc-a",
      p_recipient_id: "user-1",
      p_comment_id: "comment-1",
      p_message: "Hello",
      p_button_text: "Open",
      p_button_url: "https://example.com",
    });
  });

  it("logs a failed enqueue instead of dropping it silently", async () => {
    state.rpcError = { message: "permission denied" };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await enqueueQueuedDm({
      workspaceId: "ws-a",
      automationId: "auto-a",
      instagramAccountId: null,
      recipientId: "user-1",
      commentId: "comment-1",
      message: "Hello",
    });

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
