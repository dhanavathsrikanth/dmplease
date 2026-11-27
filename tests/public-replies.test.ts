import { describe, expect, it } from "vitest";

import {
  choosePublicReply,
  normalizePublicReplies,
  PUBLIC_REPLY_DEFAULTS,
  PUBLIC_REPLY_DEFAULT,
  PUBLIC_REPLY_LIMITS,
  publicReplyFingerprint,
  renderPublicReply,
  selectPublicReply,
} from "@/lib/public-replies";

describe("public reply variants", () => {
  it("always keeps at least three natural variants", () => {
    expect(normalizePublicReplies([]).length).toBeGreaterThanOrEqual(
      PUBLIC_REPLY_LIMITS.minVariants
    );
    expect(normalizePublicReplies(["only one"]).length).toBe(
      PUBLIC_REPLY_LIMITS.minVariants
    );
    expect(PUBLIC_REPLY_DEFAULT).toBe(PUBLIC_REPLY_DEFAULTS[0]);
  });

  it("picks a default variant when nothing is configured", () => {
    const picked = selectPublicReply([], () => 0);
    expect(PUBLIC_REPLY_DEFAULTS).toContain(picked);
  });

  it("trims, drops blanks and de-duplicates", () => {
    const normalized = normalizePublicReplies([
      "  Sent you a DM!  ",
      "",
      "sent you a dm!",
      "Here you go",
    ]);
    expect(normalized[0]).toBe("Sent you a DM!");
    expect(normalized).toContain("Here you go");
    expect(normalized.filter((item) => item === "Sent you a DM!")).toHaveLength(1);
  });

  it("caps the number of variants and the length of each", () => {
    const many = Array.from({ length: PUBLIC_REPLY_LIMITS.maxMessages + 5 }, (_, i) => `Reply ${i}`);
    expect(normalizePublicReplies(many)).toHaveLength(PUBLIC_REPLY_LIMITS.maxMessages);
    expect(normalizePublicReplies(["x".repeat(900)])[0]).toHaveLength(
      PUBLIC_REPLY_LIMITS.messageMax
    );
  });
});

describe("non-repeating rotation", () => {
  const variants = ["alpha", "beta", "gamma", "delta"];

  it("excludes the most recently used variant", () => {
    const recent = [publicReplyFingerprint("alpha")];
    const choice = choosePublicReply(variants, recent, () => 0);
    expect(choice.message).not.toBe("alpha");
  });

  it("excludes several recent variants", () => {
    const recent = [
      publicReplyFingerprint("alpha"),
      publicReplyFingerprint("beta"),
    ];
    const choice = choosePublicReply(variants, recent, () => 0);
    expect(["gamma", "delta"]).toContain(choice.message);
  });

  it("never repeats consecutively across a simulated thread", () => {
    let history: string[] = [];
    let previous = "";
    for (let index = 0; index < 20; index++) {
      const choice = choosePublicReply(variants, history, () => index / 20);
      expect(choice.message).not.toBe(previous);
      previous = choice.message;
      history = [...history, choice.fingerprint].slice(
        -PUBLIC_REPLY_LIMITS.recentHistory
      );
    }
  });

  it("never gets stuck when every variant was recently used", () => {
    const recent = variants.map(publicReplyFingerprint);
    const choice = choosePublicReply(variants, recent, () => 0);
    expect(variants).toContain(choice.message);
  });
});

describe("public reply rendering", () => {
  it("personalises the selected reply", () => {
    expect(
      renderPublicReply("Hey {username}, your {keyword} is on the way!", {
        username: "alice",
        keyword: "GUIDE",
      })
    ).toBe("Hey alice, your GUIDE is on the way!");
  });
});
