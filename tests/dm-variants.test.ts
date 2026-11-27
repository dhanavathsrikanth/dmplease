import { describe, expect, it } from "vitest";

import {
  chooseVariant,
  normalizeVariants,
  variantFingerprint,
} from "@/lib/message-variants";
import { DM_VARIANT_LIMITS, normalizeDmVariants } from "@/lib/dm-variants";

describe("DM variant normalisation", () => {
  it("uses the primary message when no variants exist", () => {
    expect(normalizeDmVariants([], "Main message")).toEqual(["Main message"]);
    expect(normalizeDmVariants(null, "Main message")).toEqual(["Main message"]);
  });

  it("drops blanks, duplicates and overlong variants", () => {
    const normalized = normalizeVariants(
      ["  Hello  ", "", "hello", "x".repeat(1200), "Different"],
      { max: 10, maxLength: 1000 }
    );
    expect(normalized).toHaveLength(3);
    expect(normalized[0]).toBe("Hello");
    expect(normalized[1]).toHaveLength(1000);
    expect(normalized[2]).toBe("Different");
  });

  it("enforces the shared cap", () => {
    const many = Array.from({ length: DM_VARIANT_LIMITS.max + 5 }, (_, i) => `Variant ${i}`);
    expect(normalizeDmVariants(many, "Main")).toHaveLength(DM_VARIANT_LIMITS.max);
  });
});

describe("history-aware variant rotation", () => {
  const variants = ["alpha", "beta", "gamma"];

  it("excludes the most recently used variant", () => {
    const recent = [variantFingerprint("alpha")];
    expect(chooseVariant(variants, recent, () => 0)?.text).not.toBe("alpha");
  });

  it("never repeats consecutively across a simulated thread", () => {
    let history: string[] = [];
    let previous = "";
    for (let index = 0; index < 20; index++) {
      const choice = chooseVariant(variants, history, () => index / 20);
      expect(choice?.text).not.toBe(previous);
      previous = choice?.text ?? "";
      history = [...history, choice?.fingerprint ?? ""].slice(-3);
    }
  });

  it("still works with a single variant", () => {
    expect(chooseVariant(["only"], [variantFingerprint("only")], () => 0)?.text).toBe(
      "only"
    );
  });

  it("returns null for an empty list", () => {
    expect(chooseVariant([], [], () => 0)).toBeNull();
  });
});
