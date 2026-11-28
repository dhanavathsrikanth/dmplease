import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  hasRedis: true,
  limitSuccess: true,
  limiterCalls: [] as Array<{ prefix: string; cap: number }>,
  limitedKeys: [] as string[],
  report: null as unknown,
}));

vi.mock("@/lib/upstash", () => ({
  hasUpstashRedis: () => state.hasRedis,
  getRateLimiterFor: (prefix: string, cap: number) => {
    state.limiterCalls.push({ prefix, cap });
    return {
      limit: async (key: string) => {
        state.limitedKeys.push(key);
        return { success: state.limitSuccess };
      },
    };
  },
}));

vi.mock("@/lib/public-report", () => ({
  loadPublicReport: async () => state.report,
}));

import { GET } from "@/app/api/reports/[token]/route";

function request(token = "report-token"): NextRequest {
  return new NextRequest(`https://app.example.com/api/reports/${token}`);
}

function context(token = "report-token") {
  return { params: Promise.resolve({ token }) };
}

const validReport = {
  workspaceName: "Acme",
  generatedAt: "2026-11-28T00:00:00.000Z",
  days: 30,
  timeZone: "Asia/Kolkata",
  totals: {
    dmsSent: 2,
    dmsFailed: 1,
    deliveryRate: 67,
    optIns: 1,
    linkClicks: 2,
    conversions: 1,
    revenueMinor: 49900,
    currency: "INR",
    comments: 10,
    leads: 4,
  },
  keywords: [],
  trend: [],
  campaigns: [],
  accounts: [],
};

beforeEach(() => {
  state.hasRedis = true;
  state.limitSuccess = true;
  state.limiterCalls = [];
  state.limitedKeys = [];
  state.report = validReport;
});

describe("GET /api/reports/[token]", () => {
  it("returns 429 when the per-token limiter rejects the request", async () => {
    state.limitSuccess = false;

    const response = await GET(request(), context());

    expect(response.status).toBe(429);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("Too many requests"),
    });
  });

  it("limits by token at 60 requests per hour", async () => {
    await GET(request("shared-token"), context("shared-token"));

    expect(state.limiterCalls).toEqual([
      { prefix: "public-report", cap: 60 },
    ]);
    expect(state.limitedKeys).toEqual(["shared-token"]);
  });

  it("returns 200 with Cache-Control: no-store for a valid report", async () => {
    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      workspaceName: "Acme",
    });
  });

  it("returns 404 with Cache-Control: no-store when the report is missing", async () => {
    state.report = null;

    const response = await GET(request(), context());

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
