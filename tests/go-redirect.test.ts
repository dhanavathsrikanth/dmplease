import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  tracked: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/meta/link-resolver", () => ({
  findTrackedLink: async () => state.tracked,
  recordTrackedLinkClick: async () => true,
}));

vi.mock("@/lib/metrics", () => ({
  recordMetricEvent: async () => {},
}));

vi.mock("@/lib/workspace-preferences", () => ({
  getWorkspaceTimeZone: async () => "UTC",
}));

vi.mock("@/lib/db-admin", () => ({
  hasAdminDb: () => false,
  getAdminDb: () => {
    throw new Error("no admin db in tests");
  },
}));

import { GET } from "@/app/go/[slug]/route";

function trackedLink(destinationUrl: string) {
  return {
    id: "link-1",
    workspace_id: "11111111-1111-4111-8111-111111111111",
    automation_id: "22222222-2222-4222-8222-222222222222",
    rotator_id: null,
    target_id: null,
    contact_id: null,
    short_code: "abc12345",
    destination_url: destinationUrl,
    label: null,
    post_id: null,
    keyword: null,
    sequence_step: null,
    active: true,
  };
}

function request(slug: string): NextRequest {
  return new NextRequest(`https://app.example.com/go/${slug}`);
}

beforeEach(() => {
  state.tracked = null;
});

describe("GET /go/[slug]", () => {
  it("refuses to redirect a tracked link to a javascript: destination", async () => {
    state.tracked = trackedLink("javascript:alert(1)");

    const response = await GET(request("abc12345"), {
      params: Promise.resolve({ slug: "abc12345" }),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://app.example.com/?link=invalid"
    );
  });

  it("refuses to redirect a tracked link to a data: destination", async () => {
    state.tracked = trackedLink("data:text/html,<script>alert(1)</script>");

    const response = await GET(request("abc12345"), {
      params: Promise.resolve({ slug: "abc12345" }),
    });

    expect(response.headers.get("location")).toBe(
      "https://app.example.com/?link=invalid"
    );
  });

  it("redirects a valid https destination with attribution", async () => {
    state.tracked = trackedLink("https://example.com/offer");

    const response = await GET(request("abc12345"), {
      params: Promise.resolve({ slug: "abc12345" }),
    });

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin).toBe("https://example.com");
    expect(location.pathname).toBe("/offer");
    expect(location.searchParams.get("utm_source")).toBe("dmplease");
    expect(location.searchParams.get("utm_medium")).toBe("instagram_dm");
    expect(location.searchParams.get("utm_campaign")).toBe(
      "22222222-2222-4222-8222-222222222222"
    );
  });
});
