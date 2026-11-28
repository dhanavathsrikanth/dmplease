import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  exchangeForLongLivedToken,
  exchangeOAuthCode,
  getLongLivedToken,
} from "@/lib/meta/client";

const APP_ID = "test-app-id";
const APP_SECRET = "test-app-secret-do-not-log";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function firstCall(fetchMock: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url: String(url), init };
}

beforeEach(() => {
  vi.stubEnv("META_APP_ID", APP_ID);
  vi.stubEnv("META_APP_SECRET", APP_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Meta app secret never travels in a query string", () => {
  it("exchangeOAuthCode (facebook) POSTs client_secret in the body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ access_token: "short", token_type: "bearer" }));
    vi.stubGlobal("fetch", fetchMock);

    await exchangeOAuthCode("auth-code", "https://app.example/callback", "facebook");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { url, init } = firstCall(fetchMock);

    expect(url).toContain("/oauth/access_token");
    expect(url).not.toContain("?");
    expect(url).not.toContain("client_secret");
    expect(url).not.toContain(APP_SECRET);

    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/x-www-form-urlencoded",
    });

    const body = new URLSearchParams(String(init.body));
    expect(body.get("client_secret")).toBe(APP_SECRET);
    expect(body.get("client_id")).toBe(APP_ID);
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("redirect_uri")).toBe("https://app.example/callback");
  });

  it("exchangeForLongLivedToken POSTs client_secret in the body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ access_token: "long", token_type: "bearer" }));
    vi.stubGlobal("fetch", fetchMock);

    await exchangeForLongLivedToken("short-lived-token");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { url, init } = firstCall(fetchMock);

    expect(url).toContain("/oauth/access_token");
    expect(url).not.toContain("?");
    expect(url).not.toContain("client_secret");
    expect(url).not.toContain(APP_SECRET);

    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/x-www-form-urlencoded",
    });

    const body = new URLSearchParams(String(init.body));
    expect(body.get("client_secret")).toBe(APP_SECRET);
    expect(body.get("client_id")).toBe(APP_ID);
    expect(body.get("grant_type")).toBe("fb_exchange_token");
    expect(body.get("fb_exchange_token")).toBe("short-lived-token");
  });

  it("getLongLivedToken keeps GET with client_secret in the query (documented limitation)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ access_token: "long", expires_in: 5184000 }));
    vi.stubGlobal("fetch", fetchMock);

    await getLongLivedToken("short-lived-token");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { url, init } = firstCall(fetchMock);

    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");

    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://graph.instagram.com");
    expect(parsed.pathname).toContain("/access_token");
    expect(parsed.searchParams.get("client_secret")).toBe(APP_SECRET);
    expect(parsed.searchParams.get("grant_type")).toBe("ig_exchange_token");
    expect(parsed.searchParams.get("access_token")).toBe("short-lived-token");
  });
});
