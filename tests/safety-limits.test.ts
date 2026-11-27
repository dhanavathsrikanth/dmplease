import { describe, expect, it, beforeEach } from "vitest";

import {
  hasRepliedRecently,
  markReplied,
  validateAutomationInput,
} from "@/lib/meta/rate-limit";
import {
  ACCOUNT_HOURLY_CEILING,
  META_PRIVATE_REPLIES_PER_HOUR,
  META_SEND_TEXT_PER_SECOND,
} from "@/lib/meta/limits";

describe("Meta limits", () => {
  it("keeps the account ceiling below Meta's private-reply limit", () => {
    expect(ACCOUNT_HOURLY_CEILING).toBeLessThan(META_PRIVATE_REPLIES_PER_HOUR);
    expect(META_PRIVATE_REPLIES_PER_HOUR).toBe(750);
    expect(META_SEND_TEXT_PER_SECOND).toBe(300);
  });
});

describe("reply-once-per-person-per-post", () => {
  beforeEach(() => {
    (globalThis as { __replyOnce?: Map<string, number> }).__replyOnce = new Map();
  });

  it("remembers a reply for the same person and post", async () => {
    expect(await hasRepliedRecently("acct", "media", "person")).toBe(false);
    await markReplied("acct", "media", "person", 30);
    expect(await hasRepliedRecently("acct", "media", "person")).toBe(true);
  });

  it("does not leak across posts or people", async () => {
    await markReplied("acct", "media-1", "person", 30);
    expect(await hasRepliedRecently("acct", "media-2", "person")).toBe(false);
    expect(await hasRepliedRecently("acct", "media-1", "other")).toBe(false);
  });
});

describe("pre-launch spam screening", () => {
  const base = {
    name: "Campaign",
    message: "Here is your guide: https://example.com",
    keywords: ["GUIDE"],
  };

  it("accepts a clean automation", () => {
    expect(validateAutomationInput(base)).toEqual([]);
  });

  it("rejects duplicate keywords", () => {
    const issues = validateAutomationInput({ ...base, keywords: ["GUIDE", "guide"] });
    expect(issues.some((issue) => issue.field === "keywords")).toBe(true);
  });

  it("rejects character floods", () => {
    const issues = validateAutomationInput({ ...base, message: "Hiiiiiiii there" });
    expect(issues.some((issue) => issue.field === "message")).toBe(true);
  });

  it("rejects all-caps spam", () => {
    const issues = validateAutomationInput({
      ...base,
      message: "THIS IS A VERY LONG ALL CAPS MESSAGE THAT LOOKS LIKE SPAM",
    });
    expect(issues.some((issue) => issue.field === "message")).toBe(true);
  });

  it("rejects duplicate variants", () => {
    const issues = validateAutomationInput({
      ...base,
      variants: ["Same text", "Same text"],
    });
    expect(issues.some((issue) => issue.field === "dmVariants")).toBe(true);
  });

  it("rejects too many links", () => {
    const issues = validateAutomationInput({
      ...base,
      message: "https://a.com https://b.com https://c.com https://d.com",
    });
    expect(issues.some((issue) => issue.field === "message")).toBe(true);
  });
});
