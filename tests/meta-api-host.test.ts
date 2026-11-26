import { describe, expect, it } from "vitest";
import { instagramApiBase } from "@/lib/meta/client";

describe("Instagram Graph API host selection", () => {
  it("uses graph.facebook.com for Facebook-linked business and system-user tokens", () => {
    expect(instagramApiBase("EAAxxxxxxxx")).toBe(
      "https://graph.facebook.com/v21.0"
    );
  });

  it("uses graph.instagram.com only for Basic Display tokens", () => {
    expect(instagramApiBase("IGxxxxxxxx")).toBe(
      "https://graph.instagram.com/v21.0"
    );
  });
});
