import { createHash, createHmac } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const keys = vi.hoisted(() => ({
  current: "sig_configured_current_key_for_tests",
  next: "sig_configured_next_key_for_tests",
}));

const state = vi.hoisted(() => ({
  hasRedis: true,
  hasDb: true,
  /** Stands in for Redis SET NX: a key present here is already claimed. */
  redisKeys: new Set<string>(),
  redisError: null as Error | null,
  dbClaim: true,
  dbError: null as Error | null,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
}));

vi.mock("@/lib/upstash", () => ({
  getQstashSigningKeys: () => ({ current: keys.current, next: keys.next }),
  hasUpstashRedis: () => state.hasRedis,
  getRedis: () => ({
    set: async (
      key: string,
      _value: string,
      options?: { nx?: boolean; ex?: number }
    ) => {
      if (state.redisError) throw state.redisError;
      if (options?.nx && state.redisKeys.has(key)) return null;
      state.redisKeys.add(key);
      return "OK";
    },
  }),
}));

vi.mock("@/lib/db-admin", () => ({
  hasAdminDb: () => state.hasDb,
  getAdminDb: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      if (state.dbError) throw state.dbError;
      return { data: state.dbClaim, error: null };
    },
  }),
}));

import { verifyQstashRequest } from "@/lib/qstash-verify";

/** The development signing key published inside @upstash/qstash. */
const PUBLIC_DEV_KEY = "sig_7kYjw48mhY7kAjqNGcy6cr29RJ6r";
const URL = "https://app.example.com/api/workers/qstash";
const BODY = JSON.stringify({ entry: [{ id: "ig-1" }] });

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

/** Mints the HS256 JWT shape QStash signs deliveries with. */
function mintSignature(key: string, body: string, url = URL): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({
      iss: "Upstash",
      sub: url,
      body: base64url(createHash("sha256").update(body).digest()),
      iat: now,
      nbf: now - 10,
      exp: now + 600,
    })
  );
  const signature = createHmac("sha256", key)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function makeRequest(signature: string | null, body = BODY): Request {
  const headers = new Headers();
  if (signature) headers.set("upstash-signature", signature);
  return new Request(URL, { method: "POST", headers, body });
}

function replayKey(signature: string): string {
  return `qstash:replay:${createHash("sha256").update(signature).digest("hex")}`;
}

beforeEach(() => {
  state.hasRedis = true;
  state.hasDb = true;
  state.redisKeys.clear();
  state.redisError = null;
  state.dbClaim = true;
  state.dbError = null;
  state.rpcCalls = [];
});

afterEach(() => {
  delete process.env.QSTASH_DEV;
});

describe("verifyQstashRequest", () => {
  it("accepts a signature minted with the configured signing key", async () => {
    const raw = await verifyQstashRequest(
      makeRequest(mintSignature(keys.current, BODY))
    );

    expect(raw).toBe(BODY);
  });

  it("rejects a public development-key signature even when QSTASH_DEV=true", async () => {
    process.env.QSTASH_DEV = "true";

    const raw = await verifyQstashRequest(
      makeRequest(mintSignature(PUBLIC_DEV_KEY, BODY))
    );

    expect(raw).toBeNull();
  });

  it("rejects a public development-key signature when QSTASH_DEV=1", async () => {
    process.env.QSTASH_DEV = "1";

    const raw = await verifyQstashRequest(
      makeRequest(mintSignature(PUBLIC_DEV_KEY, BODY))
    );

    expect(raw).toBeNull();
  });

  it("still accepts the configured key when QSTASH_DEV=true", async () => {
    process.env.QSTASH_DEV = "true";

    const raw = await verifyQstashRequest(
      makeRequest(mintSignature(keys.current, BODY))
    );

    expect(raw).toBe(BODY);
  });

  it("rejects a signature for a different URL", async () => {
    const raw = await verifyQstashRequest(
      makeRequest(mintSignature(keys.current, BODY, "https://evil.example/x"))
    );

    expect(raw).toBeNull();
  });

  it("rejects a signature over a different body", async () => {
    const raw = await verifyQstashRequest(
      makeRequest(mintSignature(keys.current, '{"entry":[]}'))
    );

    expect(raw).toBeNull();
  });

  it("rejects a request with no signature header", async () => {
    const raw = await verifyQstashRequest(makeRequest(null));

    expect(raw).toBeNull();
  });

  it("accepts a valid signature once and rejects the replay", async () => {
    const signature = mintSignature(keys.current, BODY);

    const first = await verifyQstashRequest(makeRequest(signature));
    const second = await verifyQstashRequest(makeRequest(signature));

    expect(first).toBe(BODY);
    expect(second).toBeNull();
    expect(state.redisKeys.has(replayKey(signature))).toBe(true);
  });

  it("accepts a different signature", async () => {
    const first = await verifyQstashRequest(
      makeRequest(mintSignature(keys.current, BODY))
    );

    const otherBody = JSON.stringify({ entry: [{ id: "ig-2" }] });
    const second = await verifyQstashRequest(
      makeRequest(mintSignature(keys.current, otherBody), otherBody)
    );

    expect(first).toBe(BODY);
    expect(second).toBe(otherBody);
  });

  it("falls back to the DB claim when Redis is unavailable", async () => {
    state.hasRedis = false;
    state.dbClaim = true;

    const raw = await verifyQstashRequest(
      makeRequest(mintSignature(keys.current, BODY))
    );

    expect(raw).toBe(BODY);
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.rpcCalls[0].name).toBe("claim_qstash_signature");
    expect(state.rpcCalls[0].args).toMatchObject({ p_ttl_seconds: 300 });
  });

  it("falls back to the DB claim when Redis throws", async () => {
    state.redisError = new Error("redis down");
    state.dbClaim = true;

    const raw = await verifyQstashRequest(
      makeRequest(mintSignature(keys.current, BODY))
    );

    expect(raw).toBe(BODY);
    expect(state.rpcCalls).toHaveLength(1);
  });

  it("rejects when the DB claim reports the signature was already used", async () => {
    state.hasRedis = false;
    state.dbClaim = false;

    const raw = await verifyQstashRequest(
      makeRequest(mintSignature(keys.current, BODY))
    );

    expect(raw).toBeNull();
    expect(state.rpcCalls).toHaveLength(1);
  });

  it("rejects when neither Redis nor the DB is available", async () => {
    state.hasRedis = false;
    state.hasDb = false;

    const raw = await verifyQstashRequest(
      makeRequest(mintSignature(keys.current, BODY))
    );

    expect(raw).toBeNull();
    expect(state.rpcCalls).toHaveLength(0);
  });
});
