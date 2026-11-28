import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const dbState = vi.hoisted(() => ({
  tables: {} as Record<string, unknown>,
}));

const guardState = vi.hoisted(() => ({
  optedOut: false,
  followProceed: true,
  followSkipped: undefined as string | undefined,
  sent: true,
  sendError: undefined as unknown,
}));

const rateState = vi.hoisted(() => ({
  accountAllowed: true,
  automationAllowed: true,
}));

vi.mock("@/lib/config", () => ({
  getAdminApiSecret: () => "admin-secret",
}));

vi.mock("@/lib/db-admin", () => {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    const chain = () => b;
    b.select = chain;
    b.eq = chain;
    b.gte = chain;
    b.gt = chain;
    b.order = chain;
    b.limit = chain;
    b.update = chain;
    b.maybeSingle = async () => ({
      data: dbState.tables[table] ?? null,
      error: null,
    });
    b.single = async () => ({
      data: dbState.tables[table] ?? null,
      error: null,
    });
    b.insert = async () => ({ error: null });
    return b;
  };
  return {
    hasAdminDb: () => true,
    getAdminDb: () => ({ from: (table: string) => builder(table) }),
  };
});

vi.mock("@/lib/meta/vault", () => ({
  decryptToken: () => "decrypted-token",
}));

vi.mock("@/lib/meta/rate-limit", () => ({
  acquireSendSlot: async (key: string) => ({
    allowed: key.endsWith(":account")
      ? rateState.accountAllowed
      : rateState.automationAllowed,
    remaining: 1,
    retryAfterMs: 0,
    mode: "local",
  }),
  checkRecipientCooldown: async () => true,
}));

vi.mock("@/lib/meta/follow-gate", () => ({
  normalizeFollowGateConfig: (input: Record<string, unknown>) => ({
    enabled: true,
    openingMessage: "",
    buttonLabel: "",
    onUnavailable: "hold",
    ...input,
  }),
}));

vi.mock("@/lib/meta/webhook-processor", () => ({
  isOptedOut: async () => guardState.optedOut,
  applyFollowGate: async () => ({
    proceed: guardState.followProceed,
    skipped: guardState.followSkipped,
  }),
  sendOptinDm: async () => ({
    sent: guardState.sent,
    error: guardState.sendError,
  }),
  toAutomationLike: (row: Record<string, unknown>) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    postId: row.post_id ?? null,
    followGateEnabled: row.follow_gate_enabled ?? false,
    followGateButtonLabel: row.follow_gate_button_label ?? null,
    followGateOnUnavailable: row.follow_gate_on_unavailable ?? "hold",
    openingMessage: row.opening_message ?? null,
    hourlyCap: row.hourly_cap ?? 0,
    dmMessage: row.dm_message ?? "",
    buttonUrl: row.button_url ?? null,
  }),
}));

import { POST } from "@/app/api/admin/deliver-guide/route";

const automationRow = {
  id: "auto-1",
  workspace_id: "ws-1",
  active: true,
  post_id: "media-1",
  dm_message: "Here is your guide",
  hourly_cap: 10,
  follow_gate_enabled: false,
};

const accountRow = {
  id: "acct-db-1",
  instagram_id: "ig-1",
  workspace_id: "ws-1",
  access_token: "encrypted",
};

const contactRow = { id: "contact-1" };

function seed(overrides: Record<string, unknown> = {}) {
  dbState.tables = {
    automations: automationRow,
    instagram_accounts: accountRow,
    contacts: contactRow,
    dm_logs: null,
    comment_events: null,
    ...overrides,
  };
}

function makeRequest(body: unknown) {
  return new NextRequest("https://app.example.com/api/admin/deliver-guide", {
    method: "POST",
    headers: {
      authorization: "Bearer admin-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

const validBody = { automationId: "auto-1", recipientId: "ig-user-1" };

beforeEach(() => {
  guardState.optedOut = false;
  guardState.followProceed = true;
  guardState.followSkipped = undefined;
  guardState.sent = true;
  guardState.sendError = undefined;
  rateState.accountAllowed = true;
  rateState.automationAllowed = true;
  seed();
});

describe("POST /api/admin/deliver-guide", () => {
  it("skips a paused automation", async () => {
    seed({ automations: { ...automationRow, active: false } });

    const response = await POST(makeRequest(validBody));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      skipped: "Automation is paused",
    });
  });

  it("skips an opted-out recipient", async () => {
    guardState.optedOut = true;

    const response = await POST(makeRequest(validBody));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      skipped: "Recipient opted out of automated DMs",
    });
  });

  it("skips a recipient already messaged in the last 24h", async () => {
    seed({ dm_logs: { id: "log-1" } });

    const response = await POST(makeRequest(validBody));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      skipped: "Already messaged in 24h",
    });
  });

  it("rejects an unknown recipient", async () => {
    seed({ contacts: null, comment_events: null });

    const response = await POST(makeRequest(validBody));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: "Unknown recipient",
    });
  });

  it("skips when the automation hourly cap is reached", async () => {
    rateState.automationAllowed = false;

    const response = await POST(makeRequest(validBody));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      skipped: "Automation hourly cap reached",
    });
  });

  it("sends when every guard passes", async () => {
    const response = await POST(makeRequest(validBody));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true });
  });
});
