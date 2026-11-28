import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db-admin", () => ({
  hasAdminDb: () => false,
  getAdminDb: () => {
    throw new Error("Admin DB unavailable in tests");
  },
}));

vi.mock("@/lib/meta/vault", () => ({
  decryptToken: (value: string) => value,
}));

vi.mock("@/lib/meta/delivery-guards", () => ({
  checkDeliveryGuards: async () => ({ allowed: true }),
}));

vi.mock("@/lib/meta/webhook-processor", () => ({
  sendOptinDm: async () => ({ sent: true }),
  toAutomationLike: (row: unknown) => row,
  processWebhookPayload: async () => ({
    events: [],
    sent: 0,
    failed: 0,
    skipped: 0,
    avgLatencyMs: null,
    errors: [],
    transientFailures: 0,
    permanentFailures: 0,
  }),
}));

vi.mock("@/lib/meta/webhook-events", () => ({
  markWebhookFinished: async () => {},
  markWebhookProcessing: async () => {},
}));

vi.mock("@/lib/dlq-ops", () => ({
  listDeadLetters: async () => [],
  replayDeadLetter: async () => {},
  deleteDeadLetter: async () => {},
}));

vi.mock("@/lib/profile", () => ({
  getCurrentUser: async () => null,
}));

vi.mock("@/lib/alerts/capacity", () => ({
  isVerifiedAdmin: () => false,
  runCapacityCheck: async () => ({
    created: 0,
    errors: [],
    metrics: { accounts: 0, events24h: 0, failures24h: 0 },
  }),
}));

vi.mock("@/lib/redis-lock", () => ({
  withCronLock: async (
    _key: string,
    _ttl: number,
    fn: () => Promise<unknown>
  ) => ({ locked: false, value: await fn() }),
}));

vi.mock("@/lib/posthog-server", () => ({
  captureServerEvent: () => {},
}));

vi.mock("@/lib/meta/profile-sync", () => ({
  syncInstagramProfile: async () => null,
}));

vi.mock("@/lib/upstash", () => ({
  cleanEnv: (name: string) => process.env[name] ?? "",
  getQstash: () => ({
    schedules: {
      create: async () => ({ scheduleId: "followups-hourly" }),
    },
  }),
}));

import { POST as deliverGuide } from "@/app/api/admin/deliver-guide/route";
import { POST as webhookReplay } from "@/app/api/admin/webhook-replay/route";
import { GET as dlqGet } from "@/app/api/admin/dlq/route";
import { POST as syncProfile } from "@/app/api/admin/sync-profile/route";
import { POST as followupSchedule } from "@/app/api/admin/followup-schedule/route";
import { GET as alertsCheck } from "@/app/api/admin/alerts/check/route";

function request(
  url: string,
  secret: string,
  method: "GET" | "POST",
  body?: unknown
) {
  return new NextRequest(url, {
    method,
    headers: {
      authorization: `Bearer ${secret}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function adminRequests(secret: string) {
  return {
    deliverGuide: deliverGuide(
      request("https://app.example.com/api/admin/deliver-guide", secret, "POST", {
        automationId: "auto-1",
        recipientId: "ig-user-1",
      })
    ),
    webhookReplay: webhookReplay(
      request("https://app.example.com/api/admin/webhook-replay", secret, "POST", {
        eventId: "event-1",
      })
    ),
    dlq: dlqGet(
      request("https://app.example.com/api/admin/dlq", secret, "GET")
    ),
    syncProfile: syncProfile(
      request("https://app.example.com/api/admin/sync-profile", secret, "POST", {
        accountId: "acct-1",
        workspaceId: "ws-1",
      })
    ),
    followupSchedule: followupSchedule(
      request("https://app.example.com/api/admin/followup-schedule", secret, "POST")
    ),
  };
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("CRON_SECRET", "cron-secret");
  vi.stubEnv("ADMIN_API_SECRET", "admin-secret");
  vi.stubEnv("APP_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("admin secret separation", () => {
  it("rejects the cron secret on every admin route", async () => {
    const responses = await Promise.all(
      Object.values(adminRequests("cron-secret"))
    );

    for (const response of responses) {
      expect(response.status).toBe(401);
    }
  });

  it("accepts ADMIN_API_SECRET on every admin route", async () => {
    const responses = await Promise.all(
      Object.values(adminRequests("admin-secret"))
    );

    // None of these may be rejected by the auth gate. The exact status depends
    // on the mocked downstream (503 when the admin DB is unavailable, 200 when
    // the handler completes).
    for (const response of responses) {
      expect(response.status).not.toBe(401);
    }
    expect(responses[0].status).toBe(503); // deliver-guide: no admin DB
    expect(responses[1].status).toBe(503); // webhook-replay: no admin DB
    expect(responses[2].status).toBe(200); // dlq: list succeeds
    expect(responses[3].status).toBe(200); // sync-profile: mocked sync
    expect(responses[4].status).toBe(503); // followup-schedule: no APP_URL
  });

  it("fails closed when ADMIN_API_SECRET is missing in production", async () => {
    vi.stubEnv("ADMIN_API_SECRET", "");

    const response = await deliverGuide(
      request("https://app.example.com/api/admin/deliver-guide", "cron-secret", "POST", {
        automationId: "auto-1",
        recipientId: "ig-user-1",
      })
    );

    expect(response.status).toBe(401);
  });

  it("still accepts CRON_SECRET on cron routes", async () => {
    const response = await alertsCheck(
      request("https://app.example.com/api/admin/alerts/check", "cron-secret", "GET")
    );

    expect(response.status).toBe(200);
  });

  it("rejects ADMIN_API_SECRET on cron routes", async () => {
    const response = await alertsCheck(
      request("https://app.example.com/api/admin/alerts/check", "admin-secret", "GET")
    );

    expect(response.status).toBe(401);
  });
});
