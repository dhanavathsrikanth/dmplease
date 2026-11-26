import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/upstash", () => ({
  hasUpstashRedis: () => false,
  getRedis: () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => "OK"),
    del: vi.fn(async () => 1),
  }),
}));

import {
  buildOpeningText,
  decideFollowGateAction,
  normalizeFollowGateConfig,
  verifyFollowership,
  type FollowVerification,
} from "@/lib/meta/follow-gate";

function okFetch(body: Record<string, unknown>) {
  return vi.fn(async (...args: unknown[]) => {
    // Keep the call signature variadic so tests can inspect the requested URL.
    void args;
    return { ok: true, status: 200, json: async () => body };
  });
}

const TOKEN = "EAAGtesttoken";
const ACCOUNT = "17841400000000001";
const USER = "17841400000000002";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Ask for Follow — configuration", () => {
  it("uses honest defaults and a fail-closed policy", () => {
    const config = normalizeFollowGateConfig({ enabled: true });
    expect(config.enabled).toBe(true);
    expect(config.onUnavailable).toBe("hold");
    expect(config.openingMessage).toContain("{username}");
    expect(config.buttonLabel.length).toBeGreaterThan(0);
  });

  it("truncates button labels to Meta's 20-character limit", () => {
    const config = normalizeFollowGateConfig({
      enabled: true,
      buttonLabel: "this label is definitely far too long",
      onUnavailable: "deliver",
    });
    expect(config.buttonLabel).toHaveLength(20);
    expect(config.onUnavailable).toBe("deliver");
  });

  it("treats unknown policies as hold", () => {
    expect(
      normalizeFollowGateConfig({ enabled: true, onUnavailable: "yolo" }).onUnavailable
    ).toBe("hold");
  });
});

describe("Ask for Follow — decision matrix", () => {
  const config = normalizeFollowGateConfig({ enabled: true });
  const verification = (status: FollowVerification["status"]): FollowVerification => ({
    status,
    method: "user_profile",
    checkedAt: new Date().toISOString(),
  });

  it("delivers to confirmed followers", () => {
    expect(decideFollowGateAction(config, verification("follower"))).toBe("deliver");
  });

  it("asks confirmed non-followers to follow", () => {
    expect(decideFollowGateAction(config, verification("not_follower"))).toBe("ask");
  });

  it("holds when Meta cannot verify (safe default)", () => {
    expect(decideFollowGateAction(config, verification("unavailable"))).toBe("ask");
    expect(
      decideFollowGateAction(
        normalizeFollowGateConfig({ enabled: true, onUnavailable: "deliver" }),
        verification("unavailable")
      )
    ).toBe("deliver");
  });

  it("never gates when the feature is disabled", () => {
    expect(
      decideFollowGateAction(
        normalizeFollowGateConfig({ enabled: false }),
        verification("not_follower")
      )
    ).toBe("deliver");
  });
});

describe("Ask for Follow — opening copy", () => {
  it("substitutes tokens and uses safe fallbacks", () => {
    const config = normalizeFollowGateConfig({
      enabled: true,
      openingMessage: "Hi {username}, get {keyword} at {link}",
    });
    expect(
      buildOpeningText(config, {
        username: "alice",
        keyword: "GUIDE",
        link: "https://example.com/g",
      })
    ).toBe("Hi alice, get GUIDE at https://example.com/g");
    expect(buildOpeningText(config, {})).toBe("Hi there, get this at");
  });
});

describe("Ask for Follow — Meta verification", () => {
  it("reads is_user_follow_business from the User Profile API", async () => {
    const fetchMock = okFetch({
      is_user_follow_business: true,
      username: "alice",
      id: USER,
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await verifyFollowership(TOKEN, ACCOUNT, USER);
    expect(result.status).toBe("follower");
    expect(result.method).toBe("user_profile");
    expect(result.username).toBe("alice");
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("is_user_follow_business");
    expect(url).toContain(USER);
    expect(url).not.toContain("access_token=");
  });

  it("reports a confirmed non-follower", async () => {
    vi.stubGlobal(
      "fetch",
      okFetch({ is_user_follow_business: false, username: "bob" })
    );
    const result = await verifyFollowership(TOKEN, ACCOUNT, USER);
    expect(result.status).toBe("not_follower");
  });

  it("returns unavailable (not a false negative) when consent is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({
          error: { code: 100, message: "User consent is required to access user profile." },
        }),
      }))
    );
    const result = await verifyFollowership(TOKEN, ACCOUNT, USER);
    expect(result.status).toBe("unavailable");
    expect(result.reason).toBe("consent_required");
  });

  it("retries transient Meta rate limits once and then succeeds", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        if (call === 1) {
          return {
            ok: false,
            status: 400,
            json: async () => ({ error: { code: 613, message: "rate limit" } }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ is_user_follow_business: true }) };
      })
    );
    const result = await verifyFollowership(TOKEN, ACCOUNT, USER);
    expect(result.status).toBe("follower");
    expect(call).toBe(2);
  });

  it("never throws on network failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );
    const result = await verifyFollowership(TOKEN, ACCOUNT, USER);
    expect(result.status).toBe("unavailable");
    expect(result.reason).toBe("network_error");
  });

  it("short-circuits missing identities", async () => {
    const fetchMock = okFetch({ is_user_follow_business: true });
    vi.stubGlobal("fetch", fetchMock);
    const result = await verifyFollowership(TOKEN, ACCOUNT, "");
    expect(result.status).toBe("unavailable");
    expect(result.reason).toBe("missing_identity");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
