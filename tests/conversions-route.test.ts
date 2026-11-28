import { createHmac } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { createWorkspaceToken } from "@/lib/conversions";
import { getPurposeSecret } from "@/lib/config";

const workspaceId = "e0c181fd-bd1b-4a19-9aff-ecda8d600889";

const state = vi.hoisted(() => ({
  workspace: null as { id: string; conversion_token_version: number } | null,
  upserted: [] as unknown[],
}));

interface FakeBuilder {
  select: () => FakeBuilder;
  eq: () => FakeBuilder;
  ilike: () => FakeBuilder;
  order: () => FakeBuilder;
  limit: () => FakeBuilder;
  maybeSingle: () => Promise<{ data: unknown; error: null }>;
  upsert: (row: unknown) => Promise<{ error: null }>;
}

vi.mock("@/lib/db-admin", () => ({
  hasAdminDb: () => true,
  getAdminDb: () => ({
    from: (table: string) => {
      const builder: FakeBuilder = {
        select: () => builder,
        eq: () => builder,
        ilike: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => {
          if (table === "workspaces") {
            return { data: state.workspace, error: null };
          }
          return { data: null, error: null };
        },
        upsert: async (row: unknown) => {
          state.upserted.push(row);
          return { error: null };
        },
      };
      return builder;
    },
  }),
}));

vi.mock("@/lib/upstash", () => ({
  hasUpstashRedis: () => false,
  getRateLimiterFor: () => ({ limit: async () => ({ success: true }) }),
}));

import { POST } from "@/app/api/conversions/[workspaceToken]/route";

const validBody = {
  event_type: "purchase",
  external_event_id: "evt-1",
  email: "buyer@example.com",
  revenue: 49.9,
  currency: "INR",
};

function call(token: string, body: unknown) {
  const request = new NextRequest(
    `https://app.example.com/api/conversions/${token}`,
    {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }
  );
  return POST(request, {
    params: Promise.resolve({ workspaceToken: token }),
  });
}

beforeEach(() => {
  state.workspace = { id: workspaceId, conversion_token_version: 1 };
  state.upserted = [];
});

describe("conversion ingest route", () => {
  it("rejects a token whose version does not match the workspace", async () => {
    const response = await call(createWorkspaceToken(workspaceId, 2), validBody);

    expect(response.status).toBe(401);
    expect(state.upserted).toEqual([]);
  });

  it("rejects a legacy token once the workspace has been rotated", async () => {
    const legacyBody = Buffer.from(JSON.stringify({ w: workspaceId })).toString(
      "base64url"
    );
    const signature = createHmac("sha256", getPurposeSecret("conversions-token"))
      .update(legacyBody)
      .digest("hex");

    const response = await call(`${legacyBody}.${signature}`, validBody);

    expect(response.status).toBe(401);
  });

  it("rejects metadata with too many keys", async () => {
    const metadata = Object.fromEntries(
      Array.from({ length: 21 }, (_, index) => [`key_${index}`, "value"])
    );

    const response = await call(createWorkspaceToken(workspaceId), {
      ...validBody,
      metadata,
    });

    expect(response.status).toBe(400);
    expect(state.upserted).toEqual([]);
  });

  it("rejects metadata that is too large", async () => {
    const response = await call(createWorkspaceToken(workspaceId), {
      ...validBody,
      metadata: { note: "x".repeat(5000) },
    });

    expect(response.status).toBe(400);
    expect(state.upserted).toEqual([]);
  });

  it("rejects an oversized body with 413", async () => {
    const response = await call(
      createWorkspaceToken(workspaceId),
      JSON.stringify({ ...validBody, pad: "x".repeat(20_000) })
    );

    expect(response.status).toBe(413);
    expect(state.upserted).toEqual([]);
  });

  it("returns only a success flag, with no attribution oracle", async () => {
    const response = await call(createWorkspaceToken(workspaceId), validBody);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({ success: true });
    expect(json).not.toHaveProperty("attributed");
    expect(json).not.toHaveProperty("duplicate");
    expect(state.upserted).toHaveLength(1);
  });
});
