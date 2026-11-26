import { describe, expect, it } from "vitest";
import { inHoldout } from "@/lib/followups-holdout";

describe("follow-up holdout", () => {
  it("is deterministic for the same follower and step", () => {
    const a = inHoldout("1032737163190899", 1, 10);
    const b = inHoldout("1032737163190899", 1, 10);
    expect(a).toBe(b);
  });

  it("respects 0% and 100%", () => {
    expect(inHoldout("anyone", 1, 0)).toBe(false);
    expect(inHoldout("anyone", 1, 100)).toBe(true);
  });
});
