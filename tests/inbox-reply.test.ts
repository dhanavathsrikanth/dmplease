import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  conversationExists: true,
  lastInboundAt: new Date().toISOString(),
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
    if (table === "messages") {
      return {
        data: { created_at: state.lastInboundAt },
        error: null,
      };
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
  sendDirectMessage: async (...args: unknown[]) => {
    state.sendCalls.push(args);
    return { message_id: "mid-1" };
  },
}));

import { POST } from "@/app/api/inbox/reply/route";

function request(body: unknown) {
  return new NextRequest("https://app.example.com/api/inbox/reply", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const validBody = {
  workspaceId: WORKSPACE_ID,
  conversationId: CONVERSATION_ID,
  recipientId: "igsid-1",
  recipientUsername: "someone",
  message: "hello there",
};

function messageInserts() {
  return state.calls.filter(
    (call) => call.table === "messages" && call.method === "insert"
  );
}

beforeEach(() => {
  state.conversationExists = true;
  state.lastInboundAt = new Date().toISOString();
  state.calls = [];
  state.sendCalls = [];
});

describe("POST /api/inbox/reply conversation scoping", () => {
  it("scopes the last-inbound lookup to the workspace", async () => {
    const response = await POST(request(validBody));

    expect(response.status).toBe(200);

    const messageEqCalls = state.calls.filter(
      (call) => call.table === "messages" && call.method === "eq"
    );
    expect(messageEqCalls).toContainEqual({
      table: "messages",
      method: "eq",
      args: ["conversation_id", CONVERSATION_ID],
    });
    expect(messageEqCalls).toContainEqual({
      table: "messages",
      method: "eq",
      args: ["workspace_id", WORKSPACE_ID],
    });
    expect(messageEqCalls).toContainEqual({
      table: "messages",
      method: "eq",
      args: ["direction", "inbound"],
    });
  });

  it("still stores the outbound message for a valid conversation", async () => {
    const response = await POST(request(validBody));

    expect(response.status).toBe(200);
    expect(state.sendCalls).toHaveLength(1);

    const inserts = messageInserts();
    expect(inserts).toHaveLength(1);
    expect(inserts[0].args[0]).toMatchObject({
      workspace_id: WORKSPACE_ID,
      conversation_id: CONVERSATION_ID,
      external_id: "mid-1",
      direction: "outbound",
      sender_type: "agent",
      content: { text: "hello there" },
    });
  });
});
