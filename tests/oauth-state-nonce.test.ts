import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";

const TEST_SECRET = "test-oauth-state-secret";

const state = vi.hoisted(() => ({
  nonces: new Map<string, number>(),
  storeCalls: [] as Array<{ nonce: string; ttl: number }>,
  failStore: false,
  failConsume: false,
}));

vi.mock("@/lib/config", () => ({
  getOAuthStateSecret: () => "test-oauth-state-secret",
  getOAuthStateSecrets: () => ["test-oauth-state-secret"],
}));

vi.mock("@/lib/db-admin", () => ({
  hasAdminDb: () => true,
  getAdminDb: () => ({
    rpc: async (name: string, params: Record<string, unknown>) => {
      if (name === "store_oauth_state_nonce") {
        if (state.failStore) {
          return { data: null, error: { message: "store unavailable" } };
        }
        const nonce = String(params.p_nonce);
        const ttl = Number(params.p_ttl_seconds);
        state.storeCalls.push({ nonce, ttl });
        state.nonces.set(nonce, Date.now() + ttl * 1000);
        return { data: null, error: null };
      }

      if (name === "consume_oauth_state_nonce") {
        if (state.failConsume) {
          return { data: null, error: { message: "consume unavailable" } };
        }
        const nonce = String(params.p_nonce);
        const expiresAt = state.nonces.get(nonce);
        if (expiresAt === undefined || expiresAt <= Date.now()) {
          return { data: false, error: null };
        }
        state.nonces.delete(nonce);
        return { data: true, error: null };
      }

      return { data: null, error: { message: `unknown rpc ${name}` } };
    },
  }),
}));

import { signOAuthState, verifyOAuthState } from "@/lib/meta/client";

function decodePayload(signedState: string): Record<string, unknown> {
  const [payload] = signedState.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
}

function forgeState(payload: Record<string, unknown>, secret = TEST_SECRET): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  return `${body}.${signature}`;
}

beforeEach(() => {
  state.nonces.clear();
  state.storeCalls = [];
  state.failStore = false;
  state.failConsume = false;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("OAuth state nonce", () => {
  it("verifies a state once and rejects the replay", async () => {
    const signed = await signOAuthState("user-1", "/dashboard/settings", "facebook");

    const first = await verifyOAuthState(signed);
    expect(first).toMatchObject({
      userId: "user-1",
      nextUrl: "/dashboard/settings",
      provider: "facebook",
    });

    expect(await verifyOAuthState(signed)).toBeNull();
  });

  it("rejects an expired state", async () => {
    vi.useFakeTimers();
    const signed = await signOAuthState("user-1");

    vi.advanceTimersByTime(11 * 60 * 1000);

    expect(await verifyOAuthState(signed)).toBeNull();
  });

  it("rejects a correctly signed state with no nonce", async () => {
    const signed = forgeState({
      userId: "user-1",
      nextUrl: "/dashboard/settings",
      provider: "facebook",
      expiresAt: Date.now() + 600_000,
    });

    expect(await verifyOAuthState(signed)).toBeNull();
  });

  it("rejects a state whose nonce was never stored", async () => {
    const signed = forgeState({
      userId: "user-1",
      nextUrl: "/dashboard/settings",
      provider: "facebook",
      expiresAt: Date.now() + 600_000,
      nonce: "never-stored",
    });

    expect(await verifyOAuthState(signed)).toBeNull();
  });

  it("stores the nonce when signing", async () => {
    const signed = await signOAuthState("user-1", "/dashboard/campaigns", "instagram");
    const payload = decodePayload(signed);

    expect(typeof payload.nonce).toBe("string");
    expect(state.storeCalls).toEqual([
      { nonce: payload.nonce as string, ttl: 600 },
    ]);
    expect(state.nonces.has(payload.nonce as string)).toBe(true);
  });

  it("fails closed when the nonce cannot be stored", async () => {
    state.failStore = true;

    await expect(signOAuthState("user-1")).rejects.toThrow(/nonce/i);
  });

  it("fails closed when the nonce cannot be consumed", async () => {
    const signed = await signOAuthState("user-1");
    state.failConsume = true;

    expect(await verifyOAuthState(signed)).toBeNull();
  });
});
