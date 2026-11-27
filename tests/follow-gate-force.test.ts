import { afterEach, describe, expect, it, vi } from "vitest";

const cachedFollower = {
  status: "follower",
  method: "user_profile",
  username: "alice",
  checkedAt: new Date().toISOString(),
};

vi.mock("@/lib/upstash", () => ({
  hasUpstashRedis: () => true,
  getRedis: () => ({
    get: vi.fn(async () => cachedFollower),
    set: vi.fn(async () => "OK"),
    del: vi.fn(async () => 1),
  }),
}));

import { verifyFollowership } from "@/lib/meta/follow-gate";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("verifyFollowership force option", () => {
  it("uses the cached follower when force is not set", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyFollowership("token", "acct", "user");

    expect(result.status).toBe("follower");
    expect(result.fromCache).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("bypasses the cache and asks Meta when force is true", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ is_user_follow_business: false, username: "alice" }),
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyFollowership("token", "acct", "user", "alice", {
      force: true,
    });

    expect(result.status).toBe("not_follower");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
