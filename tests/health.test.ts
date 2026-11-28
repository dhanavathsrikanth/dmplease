import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  adminSecret: "admin-secret",
  production: false,
  checks: {
    databaseUrl: true,
    supabaseServiceKey: true,
    upstashRedis: true,
    qstash: true,
    metaAppId: true,
    webhookSigning: true,
    webhookVerifyToken: true,
    tokenVault: true,
    cronSecret: true,
  },
  events: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/config", () => ({
  getAdminApiSecret: () => state.adminSecret,
  hasDatabaseUrl: () => state.checks.databaseUrl,
  hasSecret: (name: string) => {
    switch (name) {
      case "SUPABASE_SERVICE_ROLE_KEY":
        return state.checks.supabaseServiceKey;
      case "META_APP_ID":
      case "INSTAGRAM_APP_ID":
        return state.checks.metaAppId;
      case "META_VERIFY_TOKEN":
      case "WEBHOOK_VERIFY_TOKEN":
        return state.checks.webhookVerifyToken;
      case "TOKEN_VAULT_SECRET":
        return state.checks.tokenVault;
      case "CRON_SECRET":
        return state.checks.cronSecret;
      default:
        return false;
    }
  },
  isProduction: () => state.production,
}));

vi.mock("@/lib/meta/webhook", () => ({
  hasWebhookSigningSecret: () => state.checks.webhookSigning,
}));

vi.mock("@/lib/upstash", () => ({
  hasUpstashRedis: () => state.checks.upstashRedis,
  hasQstash: () => state.checks.qstash,
}));

vi.mock("@/instrumentation", () => ({
  posthogLogger: {
    emit: (event: Record<string, unknown>) => state.events.push(event),
  },
}));

import { GET } from "@/app/api/health/route";

const URL = "https://app.example.com/api/health";

function request(secret?: string): Request {
  return new Request(URL, {
    headers: secret === undefined ? {} : { authorization: `Bearer ${secret}` },
  });
}

async function body(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  state.adminSecret = "admin-secret";
  state.production = false;
  state.checks = {
    databaseUrl: true,
    supabaseServiceKey: true,
    upstashRedis: true,
    qstash: true,
    metaAppId: true,
    webhookSigning: true,
    webhookVerifyToken: true,
    tokenVault: true,
    cronSecret: true,
  };
  state.events = [];
});

describe("GET /api/health", () => {
  it("returns only ready and environment to anonymous callers", async () => {
    const response = await GET(request());
    const payload = await body(response);

    expect(response.status).toBe(200);
    expect(payload.ready).toBe(true);
    expect(payload.environment).toBe("development");
    expect(payload).not.toHaveProperty("checks");
    expect(payload).not.toHaveProperty("hint");
    expect(Object.keys(payload).sort()).toEqual(["environment", "ready"]);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("includes checks and hint for a valid admin bearer token", async () => {
    const response = await GET(request("admin-secret"));
    const payload = await body(response);

    expect(response.status).toBe(200);
    expect(payload.checks).toEqual(state.checks);
    expect(payload).toHaveProperty("hint");
  });

  it("does not include checks for a wrong secret", async () => {
    const response = await GET(request("not-the-secret"));
    const payload = await body(response);

    expect(payload).not.toHaveProperty("checks");
    expect(payload).not.toHaveProperty("hint");
  });

  it("reports ready and 200 when every check passes", async () => {
    const response = await GET(request());
    const payload = await body(response);

    expect(payload.ready).toBe(true);
    expect(response.status).toBe(200);
  });

  it("reports not ready and 503 when a check is missing", async () => {
    state.checks.cronSecret = false;

    const response = await GET(request());
    const payload = await body(response);

    expect(payload.ready).toBe(false);
    expect(response.status).toBe(503);
  });

  it("keeps the PostHog log event unchanged", async () => {
    await GET(request());

    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      body: "health_check_completed",
      attributes: {
        health_check_ready: true,
        health_check_status_code: 200,
      },
    });
  });
});
