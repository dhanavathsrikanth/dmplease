import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  hasUpstashRedis: vi.fn(),
  limit: vi.fn(),
  getRateLimiterFor: vi.fn(),
}));

vi.mock("@/lib/upstash", () => ({
  hasUpstashRedis: mocks.hasUpstashRedis,
  getRateLimiterFor: mocks.getRateLimiterFor,
}));

type GuardRoute = typeof import("@/app/api/auth/guard/route");

let POST: GuardRoute["POST"];

function guardRequest(
  body: unknown,
  headers: Record<string, string> = {}
): NextRequest {
  return new NextRequest("https://app.example.com/api/auth/guard", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  mocks.hasUpstashRedis.mockReturnValue(true);
  mocks.limit.mockResolvedValue({
    success: true,
    remaining: 9,
    reset: Date.now() + 60_000,
  });
  mocks.getRateLimiterFor.mockReturnValue({ limit: mocks.limit });

  // The route keeps module-level in-process buckets, so re-import it for a
  // clean slate on every test.
  vi.resetModules();
  ({ POST } = await import("@/app/api/auth/guard/route"));
});

describe("POST /api/auth/guard action validation", () => {
  it("rejects inherited Object.prototype keys", async () => {
    for (const action of ["constructor", "toString", "proto"]) {
      const response = await POST(guardRequest({ action }));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "Unknown action" });
    }

    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it("rejects missing and unknown actions", async () => {
    for (const body of [{}, { action: "" }, { action: "delete-everything" }]) {
      const response = await POST(guardRequest(body));
      expect(response.status).toBe(400);
    }

    expect(mocks.limit).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/guard client IP precedence", () => {
  it("prefers x-real-ip over every other header", async () => {
    const response = await POST(
      guardRequest(
        { action: "login" },
        {
          "x-real-ip": "203.0.113.7",
          "cf-connecting-ip": "198.51.100.4",
          "x-forwarded-for": "1.1.1.1, 2.2.2.2",
        }
      )
    );

    expect(response.status).toBe(200);
    expect(mocks.limit).toHaveBeenCalledWith("203.0.113.7");
  });

  it("falls back to cf-connecting-ip when x-real-ip is absent", async () => {
    await POST(
      guardRequest(
        { action: "login" },
        {
          "cf-connecting-ip": "198.51.100.4",
          "x-forwarded-for": "1.1.1.1, 2.2.2.2",
        }
      )
    );

    expect(mocks.limit).toHaveBeenCalledWith("198.51.100.4");
  });

  it("uses the rightmost x-forwarded-for element, not the client-supplied leftmost", async () => {
    await POST(
      guardRequest(
        { action: "login" },
        { "x-forwarded-for": "1.1.1.1, 203.0.113.9" }
      )
    );

    expect(mocks.limit).toHaveBeenCalledWith("203.0.113.9");
    expect(mocks.limit).not.toHaveBeenCalledWith("1.1.1.1");
  });

  it("falls back to unknown when no address header is present", async () => {
    await POST(guardRequest({ action: "login" }));

    expect(mocks.limit).toHaveBeenCalledWith("unknown");
  });
});

describe("POST /api/auth/guard in-process self-limit", () => {
  it("returns 429 without calling Upstash once the per-IP cap is reached", async () => {
    const headers = { "x-real-ip": "203.0.113.20" };

    for (let i = 0; i < 60; i += 1) {
      const response = await POST(guardRequest({ action: "login" }, headers));
      expect(response.status).toBe(200);
    }

    expect(mocks.limit).toHaveBeenCalledTimes(60);

    const blocked = await POST(guardRequest({ action: "login" }, headers));

    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    await expect(blocked.json()).resolves.toMatchObject({ allowed: false });
    expect(mocks.limit).toHaveBeenCalledTimes(60);
  });

  it("keeps separate buckets per IP", async () => {
    for (let i = 0; i < 60; i += 1) {
      await POST(
        guardRequest({ action: "login" }, { "x-real-ip": "203.0.113.30" })
      );
    }

    const otherIp = await POST(
      guardRequest({ action: "login" }, { "x-real-ip": "203.0.113.31" })
    );

    expect(otherIp.status).toBe(200);
    expect(mocks.limit).toHaveBeenCalledTimes(61);
  });
});

describe("POST /api/auth/guard happy path", () => {
  it("calls the limiter and allows a normal request", async () => {
    const response = await POST(
      guardRequest({ action: "signup" }, { "x-real-ip": "203.0.113.40" })
    );

    expect(response.status).toBe(200);
    expect(mocks.getRateLimiterFor).toHaveBeenCalledWith("auth:signup", 10);
    expect(mocks.limit).toHaveBeenCalledTimes(1);
    expect(mocks.limit).toHaveBeenCalledWith("203.0.113.40");
    await expect(response.json()).resolves.toMatchObject({ allowed: true });
  });

  it("fails open when Upstash is not configured", async () => {
    mocks.hasUpstashRedis.mockReturnValue(false);

    const response = await POST(guardRequest({ action: "login" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      allowed: true,
      remaining: null,
      reset: null,
    });
    expect(mocks.limit).not.toHaveBeenCalled();
  });
});
