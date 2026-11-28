import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({ signedNext: null as string | null }));

vi.mock("@/lib/profile", () => ({
  getCurrentUser: async () => ({ id: "user-1" }),
}));

vi.mock("@/lib/meta/client", () => ({
  signOAuthState: (_userId: string, nextUrl: string) => {
    state.signedNext = nextUrl;
    return "state-token";
  },
}));

import { GET } from "@/app/api/auth/meta/connect/route";

afterEach(() => {
  vi.unstubAllEnvs();
  state.signedNext = null;
});

describe("connect route next validation", () => {
  it("signs a safe path for a protocol-relative next", async () => {
    vi.stubEnv("META_APP_ID", "app-id");
    const request = new NextRequest(
      "https://app.example.com/api/auth/meta/connect?next=//evil.example&provider=facebook"
    );

    await GET(request);

    expect(state.signedNext).toBe("/dashboard/settings");
  });

  it("signs a safe path for a backslash-normalized next", async () => {
    vi.stubEnv("META_APP_ID", "app-id");
    const request = new NextRequest(
      "https://app.example.com/api/auth/meta/connect?next=/%5Cevil.example&provider=facebook"
    );

    await GET(request);

    expect(state.signedNext).toBe("/dashboard/settings");
  });

  it("keeps a rooted same-origin path", async () => {
    vi.stubEnv("META_APP_ID", "app-id");
    const request = new NextRequest(
      "https://app.example.com/api/auth/meta/connect?next=/dashboard/campaigns&provider=facebook"
    );

    await GET(request);

    expect(state.signedNext).toBe("/dashboard/campaigns");
  });
});
