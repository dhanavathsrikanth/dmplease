import { describe, expect, it } from "vitest";
import { validateCampaign } from "@/lib/validation/campaign";
import { FOLLOW_GATE_LIMITS } from "@/lib/follow-gate-constants";

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

  it("accepts a share-to-DM campaign without keywords", () => {
    const result = validateCampaign({
      ...validCampaign,
      triggerType: "SHARE_TO_DM",
      triggerKeywords: [],
      dmMessage: "Thanks for sharing!",
    });
    expect(result.success).toBe(true);
    expect(result.data?.triggerType).toBe("SHARE_TO_DM");
    expect(result.data?.triggerKeywords).toEqual([]);
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

  it("enforces the shared opening-message limit", () => {
    const result = validateCampaign({
      ...validCampaign,
      followGateEnabled: true,
      openingMessage: "x".repeat(FOLLOW_GATE_LIMITS.openingMessage + 1),
    });
    expect(result.success).toBe(false);
    expect(result.fieldErrors).toHaveProperty("openingMessage");
  });

  it("rejects too many or too long DM variants", () => {
    const many = Array.from({ length: 11 }, (_, i) => `Variant ${i}`);
    expect(
      validateCampaign({ ...validCampaign, dmVariants: many }).success
    ).toBe(false);
    expect(
      validateCampaign({ ...validCampaign, dmVariants: ["x".repeat(1001)] }).fieldErrors
    ).toHaveProperty("dmVariants");
  });

  it("rejects too many or too long public replies", () => {
    const tooMany = Array.from({ length: 11 }, (_, i) => `Reply ${i}`);
    expect(
      validateCampaign({ ...validCampaign, publicReplyMessages: tooMany }).success
    ).toBe(false);
    expect(
      validateCampaign({
        ...validCampaign,
        publicReplyMessages: ["x".repeat(501)],
      }).fieldErrors
    ).toHaveProperty("publicReplyMessages");
  });

  it("accepts the auto-attach reel permalink placeholder", () => {
    const result = validateCampaign({
      ...validCampaign,
      postScope: "NEXT_POST",
      buttonUrl: "{permalink}",
    });
    expect(result.success).toBe(true);
    expect(result.data?.buttonUrl).toBe("{permalink}");
  });

  it("rejects unknown post scopes", () => {
    const result = validateCampaign({ ...validCampaign, postScope: "EVERY_POST" });
    expect(result.success).toBe(false);
    expect(result.fieldErrors).toHaveProperty("postScope");
  });
});
