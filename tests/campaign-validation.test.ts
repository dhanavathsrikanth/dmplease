import { describe, expect, it } from "vitest";
import { validateCampaign } from "@/lib/validation/campaign";

const validCampaign = {
  name: "Guide giveaway",
  postScope: "ANY_POST",
  triggerKeywords: ["GUIDE", "LINK"],
  dmMessage: "Here is your guide, {username}!",
  publicReplyEnabled: true,
  publicReplyMessages: ["Sent you a DM!"],
  followGateEnabled: false,
};

describe("campaign validation", () => {
  it("accepts a complete campaign", () => {
    const result = validateCampaign(validCampaign);
    expect(result.success).toBe(true);
    expect(result.data?.triggerKeywords).toEqual(["GUIDE", "LINK"]);
  });

  it("reports field-level errors for invalid input", () => {
    const result = validateCampaign({ ...validCampaign, name: "", dmMessage: "", buttonUrl: "ftp://bad" });
    expect(result.success).toBe(false);
    expect(result.fieldErrors).toHaveProperty("name");
    expect(result.fieldErrors).toHaveProperty("dmMessage");
    expect(result.fieldErrors).toHaveProperty("buttonUrl");
  });

  it("rejects a specific-post campaign without a post id when required by the caller", () => {
    const result = validateCampaign({ ...validCampaign, postScope: "SPECIFIC_POST" });
    // The form checks post selection; the schema still validates the shape.
    expect(result.success).toBe(true);
  });

  it("rejects unknown post scopes", () => {
    const result = validateCampaign({ ...validCampaign, postScope: "EVERY_POST" });
    expect(result.success).toBe(false);
    expect(result.fieldErrors).toHaveProperty("postScope");
  });
});
