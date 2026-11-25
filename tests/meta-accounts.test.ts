import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchInstagramAccountsForToken } from "@/lib/meta/client";

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockFetch(responses: Array<{ ok: boolean; json: unknown }>) {
  const calls: string[] = [];
  let index = 0;
  const fn = vi.fn(async (input: string | URL) => {
    calls.push(String(input));
    const response = responses[Math.min(index, responses.length - 1)];
    index++;
    return {
      ok: response.ok,
      status: response.ok ? 200 : 400,
      json: async () => response.json,
      text: async () => JSON.stringify(response.json),
    } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

describe("Instagram account discovery", () => {
  it("uses graph.instagram.com for an Instagram Login token", async () => {
    const calls = mockFetch([
      {
        ok: true,
        json: {
          id: "1789",
          user_id: "1789",
          username: "creator",
          account_type: "CREATOR",
          followers_count: 1200,
        },
      },
    ]);

    const accounts = await fetchInstagramAccountsForToken("IG-token", "instagram");

    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      instagramBusinessId: "1789",
      username: "creator",
    });
    expect(calls[0]).toContain("graph.instagram.com");
  });

  it("does not treat a personal Instagram account as automatable", async () => {
    mockFetch([
      {
        ok: true,
        json: { id: "1", username: "personal", account_type: "PERSONAL" },
      },
    ]);
    const accounts = await fetchInstagramAccountsForToken("IG-token", "instagram");
    expect(accounts).toHaveLength(0);
  });

  it("finds accounts via assignment edges when /me/accounts is empty (system-user token)", async () => {
    const calls = mockFetch([
      { ok: true, json: { data: [] } },
      {
        ok: true,
        json: {
          data: [
            {
              id: "ig-suat",
              username: "agency_client",
              name: "Client account",
              followers_count: 900,
            },
          ],
        },
      },
    ]);

    const accounts = await fetchInstagramAccountsForToken("EAA-system-user", "facebook");

    expect(accounts).toHaveLength(1);
    expect(accounts[0].instagramBusinessId).toBe("ig-suat");
    expect(calls.some((call) => call.includes("assigned_instagram_accounts"))).toBe(true);
  });

  it("reads the linked Instagram account from a Facebook Page", async () => {
    const calls = mockFetch([
      {
        ok: true,
        json: {
          data: [
            {
              id: "page-1",
              name: "My Page",
              access_token: "page-token",
              instagram_business_account: {
                id: "ig-1",
                username: "business",
                followers_count: 500,
              },
            },
          ],
        },
      },
    ]);

    const accounts = await fetchInstagramAccountsForToken("EAA-token", "facebook");

    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      instagramBusinessId: "ig-1",
      facebookPageId: "page-1",
      pageToken: "page-token",
    });
    expect(calls[0]).toContain("graph.facebook.com");
  });
});
