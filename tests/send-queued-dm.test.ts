import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeState {
  raw: string | null;
  hasDb: boolean;
  automationRow: Record<string, unknown> | null;
  reads: Array<{ table: string; filters: Array<[string, unknown]> }>;
}

const state = vi.hoisted<FakeState>(() => ({
  raw: null,
  hasDb: true,
  automationRow: null,
  reads: [],
}));

const processMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/qstash-verify", () => ({
  verifyQstashRequest: async () => state.raw,
}));

vi.mock("@/lib/db-admin", () => ({
  hasAdminDb: () => state.hasDb,
  getAdminDb: () => makeDb(),
}));

vi.mock("@/lib/meta/webhook-processor", () => ({
  toAutomationLike: (row: Record<string, unknown>) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    dmMessage: row.dm_message ?? "",
    buttonUrl: row.button_url ?? null,
    hourlyCap: row.hourly_cap ?? 0,
  }),
  processCommentEventForAutomation: processMock,
}));

function makeDb() {
  return {
    from: (table: string) => {
      const filters: Array<[string, unknown]> = [];
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return builder;
        },
        maybeSingle: async () => {
          state.reads.push({ table, filters: [...filters] });
          return { data: state.automationRow, error: null };
        },
      };
      return builder;
    },
  };
}

import { POST } from "@/app/api/workers/send-queued-dm/route";

const event = {
  commentId: "comment-1",
  instagramAccountId: "acc-1",
  senderId: "user-1",
  text: "link",
  mediaId: "media-1",
};

function request(body: unknown) {
  return new Request("https://example.com/api/workers/send-queued-dm", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const staleAuto = {
  id: "auto-1",
  workspaceId: "ws-stale",
  dmMessage: "Stale copy",
  buttonUrl: "https://stale.example",
  hourlyCap: 99,
};

beforeEach(() => {
  state.raw = null;
  state.hasDb = true;
  state.automationRow = null;
  state.reads = [];
  processMock.mockReset();
  processMock.mockResolvedValue({ sent: true });
});

describe("send-queued-dm worker", () => {
  it("skips permanently when the campaign no longer exists", async () => {
    state.raw = JSON.stringify({ event, auto: staleAuto, attempts: 2 });
    state.automationRow = null;

    const response = await POST(request({ event, auto: staleAuto, attempts: 2 }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      sent: false,
      skipped: "Campaign no longer exists",
    });
    expect(processMock).not.toHaveBeenCalled();
  });

  it("skips when the campaign is paused", async () => {
    state.raw = JSON.stringify({ event, auto: staleAuto, attempts: 1 });
    state.automationRow = {
      id: "auto-1",
      workspace_id: "ws-1",
      active: false,
      dm_message: "Fresh copy",
    };

    const response = await POST(request({ event, auto: staleAuto, attempts: 1 }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      sent: false,
      skipped: "Campaign is paused",
    });
    expect(processMock).not.toHaveBeenCalled();
  });

  it("uses the fresh automation row instead of the message body", async () => {
    state.raw = JSON.stringify({ event, auto: staleAuto, attempts: 3 });
    state.automationRow = {
      id: "auto-1",
      workspace_id: "ws-1",
      active: true,
      dm_message: "Fresh copy",
      button_url: "https://fresh.example",
      hourly_cap: 5,
    };

    const response = await POST(request({ event, auto: staleAuto, attempts: 3 }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: true });
    expect(state.reads).toEqual([
      { table: "automations", filters: [["id", "auto-1"]] },
    ]);
    expect(processMock).toHaveBeenCalledTimes(1);
    const [receivedEvent, receivedAuto, receivedAttempts] = processMock.mock.calls[0];
    expect(receivedEvent).toEqual(event);
    expect(receivedAuto).toEqual({
      id: "auto-1",
      workspaceId: "ws-1",
      dmMessage: "Fresh copy",
      buttonUrl: "https://fresh.example",
      hourlyCap: 5,
    });
    expect(receivedAuto.dmMessage).not.toBe("Stale copy");
    expect(receivedAttempts).toBe(3);
  });

  it("returns a permanent skip for an invalid payload", async () => {
    state.raw = JSON.stringify({ event: {}, auto: {} });

    const response = await POST(request({ event: {}, auto: {} }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "skipped_permanent_error",
      error: "Invalid payload",
    });
    expect(processMock).not.toHaveBeenCalled();
  });

  it("returns 503 when the database is unavailable", async () => {
    state.raw = JSON.stringify({ event, auto: staleAuto, attempts: 1 });
    state.hasDb = false;

    const response = await POST(request({ event, auto: staleAuto, attempts: 1 }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Database unavailable" });
    expect(processMock).not.toHaveBeenCalled();
  });
});
