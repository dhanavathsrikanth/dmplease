import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  conversationExists: true,
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
  sendCalls: [] as unknown[][],
}));

vi.mock("@/lib/supabase/server", () => {
  function resolveSingle(table: string) {
    if (table === "workspaces") {
      return { data: { id: "ws-1" }, error: null };
    }
    if (table === "conversations") {
      return {
        data: state.conversationExists ? { id: "conv-1" } : null,
        error: null,
      };
    }
    if (table === "pending_dms") {
      return { data: { id: "pending-1" }, error: null };
    }
    if (table === "follow_prompts") {
      return { data: { id: "prompt-1" }, error: null };
    }
    return { data: null, error: null };
  }

  function resolveList(table: string) {
    if (table === "instagram_accounts") {
      return {
        data: [
          {
            id: "acc-1",
            instagram_id: "ig-1",
            access_token: "enc-token",
            username: "creator",
          },
        ],
        error: null,
      };
    }
    return { data: [], error: null };
  }

  function makeBuilder(table: string) {
    const builder: Record<string, unknown> = {
      select: (...args: unknown[]) => {
        state.calls.push({ table, method: "select", args });
        return builder;
      },
      eq: (...args: unknown[]) => {
        state.calls.push({ table, method: "eq", args });
        return builder;
      },
      limit: (...args: unknown[]) => {
        state.calls.push({ table, method: "limit", args });
        return builder;
      },
      order: (...args: unknown[]) => {
        state.calls.push({ table, method: "order", args });
        return builder;
      },
      maybeSingle: () => {
        state.calls.push({ table, method: "maybeSingle", args: [] });
        return Promise.resolve(resolveSingle(table));
      },
      single: () => {
        state.calls.push({ table, method: "single", args: [] });
        return Promise.resolve(resolveSingle(table));
      },
      insert: (payload: unknown) => {
        state.calls.push({ table, method: "insert", args: [payload] });
        return builder;
      },
      delete: () => {
        state.calls.push({ table, method: "delete", args: [] });
        return builder;
      },
      update: (payload: unknown) => {
        state.calls.push({ table, method: "update", args: [payload] });
        return builder;
      },
      then: (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown
      ) => Promise.resolve(resolveList(table)).then(resolve, reject),
    };
    return builder;
  }

  return {
    createClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
      },
      from: (table: string) => makeBuilder(table),
    }),
  };
});

vi.mock("@/lib/meta/vault", () => ({
  decryptToken: () => "plain-token",
}));

vi.mock("@/lib/meta/client", () => ({
  sendDirectMessageWithButton: async (...args: unknown[]) => {
    state.sendCalls.push(args);
    return { message_id: "mid-1" };
  },
}));

vi.mock("@/lib/meta/follow-gate", () => ({
  verifyFollowership: async () => ({ status: "not_follower" }),
}));

vi.mock("@/lib/posthog-server", () => ({
  captureServerEvent: () => undefined,
}));

import { POST } from "@/app/api/inbox/follow-prompt/route";

function request(body: unknown) {
  return new NextRequest("https://app.example.com/api/inbox/follow-prompt", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const baseBody = {
  workspaceId: WORKSPACE_ID,
  recipientId: "igsid-1",
  recipientUsername: "someone",
};

function insertsFor(table: string) {
  return state.calls.filter(
    (call) => call.table === table && call.method === "insert"
  );
}

beforeEach(() => {
  state.conversationExists = true;
  state.calls = [];
  state.sendCalls = [];
});

describe("POST /api/inbox/follow-prompt conversation scoping", () => {
  it("returns 404 and writes nothing when the conversation is not in the workspace", async () => {
    state.conversationExists = false;

    const response = await POST(
      request({ ...baseBody, conversationId: CONVERSATION_ID })
    );

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/conversation not found/i);

    expect(insertsFor("pending_dms")).toHaveLength(0);
    expect(insertsFor("follow_prompts")).toHaveLength(0);
    expect(insertsFor("messages")).toHaveLength(0);
    expect(state.sendCalls).toHaveLength(0);
  });

  it("validates the conversation against the workspace before inserting", async () => {
    const response = await POST(
      request({ ...baseBody, conversationId: CONVERSATION_ID })
    );

    expect(response.status).toBe(200);

    const conversationCalls = state.calls.filter(
      (call) => call.table === "conversations"
    );
    expect(conversationCalls).toContainEqual({
      table: "conversations",
      method: "eq",
      args: ["id", CONVERSATION_ID],
    });
    expect(conversationCalls).toContainEqual({
      table: "conversations",
      method: "eq",
      args: ["workspace_id", WORKSPACE_ID],
    });

    const messageInserts = insertsFor("messages");
    expect(messageInserts).toHaveLength(1);
    expect(messageInserts[0].args[0]).toMatchObject({
      workspace_id: WORKSPACE_ID,
      conversation_id: CONVERSATION_ID,
      direction: "outbound",
    });
  });

  it("skips the conversation lookup when no conversationId is supplied", async () => {
    const response = await POST(request(baseBody));

    expect(response.status).toBe(200);

    expect(
      state.calls.filter((call) => call.table === "conversations")
    ).toHaveLength(0);
    expect(insertsFor("pending_dms")).toHaveLength(1);
    expect(insertsFor("follow_prompts")).toHaveLength(1);
    expect(insertsFor("messages")).toHaveLength(0);
    expect(state.sendCalls).toHaveLength(1);
  });
});
