import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

interface FakeDlqMessage {
  dlqId: string;
  messageId?: string;
  url?: string;
  responseStatus?: number;
  responseBody?: string;
  createdAt?: number;
}

const state = vi.hoisted(() => ({
  user: null as { email: string; email_confirmed_at: string | null } | null,
  messages: [] as FakeDlqMessage[],
  retried: [] as string[],
  deleted: [] as string[],
}));

vi.mock("@/lib/profile", () => ({
  getCurrentUser: async () => state.user,
}));

vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return {
    ...actual,
    getCronSecret: () => "cron-secret",
    getAdminApiSecret: () => "admin-secret",
  };
});

vi.mock("@/lib/upstash", () => ({
  hasQstash: () => true,
  getQstashWorkerUrl: () => process.env.QSTASH_WORKER_URL ?? "",
  getQstash: () => ({
    dlq: {
      listMessages: async () => ({ messages: state.messages }),
      retry: async (dlqId: string) => {
        state.retried.push(dlqId);
      },
      delete: async (dlqId: string) => {
        state.deleted.push(dlqId);
      },
    },
  }),
}));

import { GET, POST } from "@/app/api/admin/dlq/route";

afterEach(() => {
  vi.unstubAllEnvs();
  state.user = null;
  state.messages = [];
  state.retried = [];
  state.deleted = [];
});

function post(body: unknown): NextRequest {
  return new NextRequest("https://app.example.com/api/admin/dlq", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("admin DLQ gate", () => {
  it("rejects an unconfirmed admin email", async () => {
    vi.stubEnv("ADMIN_ALERT_EMAILS", "admin@example.com");
    state.user = { email: "admin@example.com", email_confirmed_at: null };

    const response = await GET(
      new NextRequest("https://app.example.com/api/admin/dlq")
    );

    expect(response.status).toBe(401);
  });

  it("rejects a confirmed non-admin email", async () => {
    vi.stubEnv("ADMIN_ALERT_EMAILS", "admin@example.com");
    state.user = {
      email: "someone@example.com",
      email_confirmed_at: "2026-01-01T00:00:00Z",
    };

    const response = await GET(
      new NextRequest("https://app.example.com/api/admin/dlq")
    );

    expect(response.status).toBe(401);
  });

  it("accepts a confirmed admin email", async () => {
    vi.stubEnv("ADMIN_ALERT_EMAILS", "admin@example.com");
    state.user = {
      email: "admin@example.com",
      email_confirmed_at: "2026-01-01T00:00:00Z",
    };

    const response = await GET(
      new NextRequest("https://app.example.com/api/admin/dlq")
    );

    expect(response.status).toBe(200);
  });
});

describe("admin DLQ ownership", () => {
  function signInAsAdmin() {
    vi.stubEnv("ADMIN_ALERT_EMAILS", "admin@example.com");
    state.user = {
      email: "admin@example.com",
      email_confirmed_at: "2026-01-01T00:00:00Z",
    };
  }

  it("returns 404 when the dlqId is not in this account's dead letters", async () => {
    signInAsAdmin();
    vi.stubEnv("APP_URL", "https://app.example.com");
    state.messages = [
      {
        dlqId: "dlq_other",
        messageId: "msg_other",
        url: "https://app.example.com/api/workers/send-queued-dm",
      },
    ];

    const response = await POST(post({ action: "replay", dlqId: "dlq_missing" }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Unknown DLQ message" });
    expect(state.retried).toEqual([]);
  });

  it("replays a dead letter that belongs to this deployment", async () => {
    signInAsAdmin();
    vi.stubEnv("APP_URL", "https://app.example.com");
    state.messages = [
      {
        dlqId: "dlq_owned",
        messageId: "msg_owned",
        url: "https://app.example.com/api/workers/send-queued-dm",
      },
    ];

    const response = await POST(post({ action: "replay", dlqId: "dlq_owned" }));

    expect(response.status).toBe(200);
    expect(state.retried).toEqual(["dlq_owned"]);
  });

  it("returns 404 when the dead letter targets a foreign origin", async () => {
    signInAsAdmin();
    vi.stubEnv("APP_URL", "https://app.example.com");
    state.messages = [
      {
        dlqId: "dlq_foreign",
        messageId: "msg_foreign",
        url: "https://attacker.example.net/api/workers/send-queued-dm",
      },
    ];

    const response = await POST(post({ action: "delete", dlqId: "dlq_foreign" }));

    expect(response.status).toBe(404);
    expect(state.deleted).toEqual([]);
  });
});
