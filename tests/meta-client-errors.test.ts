import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  exchangeForLongLivedToken,
  exchangeOAuthCode,
  getLongLivedToken,
} from "@/lib/meta/client";

// The token exchange helpers read credentials from the environment, but the
// module also pulls OAuth-state helpers from @/lib/config. Stub that module so
// these tests never depend on unrelated runtime configuration.
vi.mock("@/lib/config", () => ({
  getOAuthStateSecret: () => "test-oauth-state-secret",
  getOAuthStateSecrets: () => ["test-oauth-state-secret"],
}));

const APP_ID = "test-app-id";
const APP_SECRET = "test-app-secret-do-not-log";
const PROXY_HINT =
  "The egress proxy/WAF in front of this deployment must allow POST to graph.facebook.com.";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }
  throw new Error("Expected the call to reject, but it resolved");
}

beforeEach(() => {
  vi.stubEnv("META_APP_ID", APP_ID);
  vi.stubEnv("META_APP_SECRET", APP_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("token exchange proxy failures", () => {
  it("explains a 405 from the Facebook code exchange without leaking the secret or URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { message: "Method Not Allowed" } }, 405));
    vi.stubGlobal("fetch", fetchMock);

    const error = await captureError(
      exchangeOAuthCode("auth-code", "https://app.example/callback", "facebook")
    );

    expect(error.message).toContain("Meta OAuth code exchange failed (405)");
    expect(error.message).toContain(PROXY_HINT);
    expect(error.message).not.toContain("client_secret");
    expect(error.message).not.toContain(APP_SECRET);
    expect(error.message).not.toContain("https://graph.facebook.com");
    expect(error.message).not.toContain("/oauth/access_token");
  });

  it("explains a 405 from the long-lived token exchange", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { message: "Method Not Allowed" } }, 405));
    vi.stubGlobal("fetch", fetchMock);

    const error = await captureError(exchangeForLongLivedToken("short-lived-token"));

    expect(error.message).toContain("Meta long-lived token exchange failed (405)");
    expect(error.message).toContain(PROXY_HINT);
    expect(error.message).not.toContain("client_secret");
    expect(error.message).not.toContain(APP_SECRET);
    expect(error.message).not.toContain("https://graph.facebook.com");
    expect(error.message).not.toContain("/oauth/access_token");
  });

  it("does not blame the proxy for a 500", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { message: "Internal error" } }, 500));
    vi.stubGlobal("fetch", fetchMock);

    const error = await captureError(exchangeForLongLivedToken("short-lived-token"));

    expect(error.message).toContain("Meta long-lived token exchange failed (500)");
    expect(error.message).not.toContain("egress proxy/WAF");
    expect(error.message).not.toContain(PROXY_HINT);
  });
});

describe("getLongLivedToken secret redaction", () => {
  it("never surfaces the Instagram URL or client_secret when both exchanges fail", async () => {
    const instagramText = vi.fn(async () =>
      // Simulate a proxy that echoes the request URL back in the error body.
      JSON.stringify({
        error: {
          message:
            "blocked https://graph.instagram.com/v21.0/access_token?client_secret=" +
            APP_SECRET +
            "&access_token=short-lived-token",
        },
      })
    );
    const instagramResponse = {
      ok: false,
      status: 500,
      json: async () => ({}),
      text: instagramText,
    } as unknown as Response;

    const facebookResponse = jsonResponse(
      { error: { message: "Invalid OAuth access token" } },
      500
    );

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(instagramResponse)
      .mockResolvedValueOnce(facebookResponse);
    vi.stubGlobal("fetch", fetchMock);

    const error = await captureError(getLongLivedToken("short-lived-token"));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The Instagram body is never read, so an echoing proxy cannot leak it.
    expect(instagramText).not.toHaveBeenCalled();

    expect(error.message).toContain("Meta long-lived token exchange failed (500)");
    expect(error.message).not.toContain("client_secret");
    expect(error.message).not.toContain(APP_SECRET);
    expect(error.message).not.toContain("access_token=");
    expect(error.message).not.toContain("graph.instagram.com");
  });

  it("falls back to the Facebook exchange when the Instagram GET rejects", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(
        new TypeError(
          "fetch failed: https://graph.instagram.com/v21.0/access_token?client_secret=" +
            APP_SECRET
        )
      )
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "long-lived", expires_in: 5184000 })
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getLongLivedToken("short-lived-token");

    expect(result).toEqual({ accessToken: "long-lived", expiresIn: 5184000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
