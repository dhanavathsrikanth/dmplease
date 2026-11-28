import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeInstagramAccountToWebhooks } from "@/lib/meta/client";

const HOSTILE_ID = "123/../evil?x=1";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("subscribeInstagramAccountToWebhooks path encoding", () => {
  it("encodes the account id so it cannot escape the path segment", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await subscribeInstagramAccountToWebhooks(HOSTILE_ID, "token");

    expect(result).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    const requested = String(url);
    const encoded = encodeURIComponent(HOSTILE_ID);

    expect(encoded).toBe("123%2F..%2Fevil%3Fx%3D1");
    expect(requested).toContain(`/${encoded}/subscribed_apps`);
    expect(requested).not.toContain("/../");
    expect(requested).not.toContain("?x=1");

    const parsed = new URL(requested);
    const version = process.env.META_API_VERSION || "v21.0";
    expect(parsed.pathname).toBe(`/${version}/${encoded}/subscribed_apps`);
    expect(parsed.search).toBe("");
  });
});
