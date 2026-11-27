import { describe, expect, it } from "vitest";

import {
  FOLLOW_GATE_DEFAULTS,
  FOLLOW_GATE_LIMITS,
} from "@/lib/follow-gate-constants";
import {
  buildOpeningText,
  normalizeOpeningTemplate,
  renderOpeningDm,
} from "@/lib/meta/opening-dm";

describe("opening DM copy", () => {
  it("uses shared defaults for empty or legacy stored copy", () => {
    const template = normalizeOpeningTemplate({
      openingMessage: "   ",
      buttonLabel: null,
    });
    expect(template.openingMessage).toBe(FOLLOW_GATE_DEFAULTS.openingMessage);
    expect(template.buttonLabel).toBe(FOLLOW_GATE_DEFAULTS.buttonLabel);
    expect(normalizeOpeningTemplate(null).openingMessage).toBe(
      FOLLOW_GATE_DEFAULTS.openingMessage
    );
  });

  it("preserves creator copy and truncates overlong button labels", () => {
    const template = normalizeOpeningTemplate({
      openingMessage: "  Follow me for your {keyword}!  ",
      buttonLabel: "x".repeat(FOLLOW_GATE_LIMITS.buttonLabel + 5),
    });
    expect(template.openingMessage).toBe("Follow me for your {keyword}!");
    expect(template.buttonLabel).toHaveLength(FOLLOW_GATE_LIMITS.buttonLabel);
  });

  it("interpolates all supported placeholders case-insensitively", () => {
    const text = buildOpeningText(
      { openingMessage: "Hi {USERNAME}, follow for {Keyword}: {LINK}", buttonLabel: "OK" },
      {
        username: "alice",
        keyword: "GUIDE",
        link: "https://instagram.com/reel/abc",
      }
    );
    expect(text).toBe("Hi alice, follow for GUIDE: https://instagram.com/reel/abc");
  });

  it("uses safe fallbacks for missing variables", () => {
    const text = buildOpeningText(
      { openingMessage: "Hi {username}, get {keyword} at {link}", buttonLabel: "OK" },
      {}
    );
    expect(text).toBe("Hi there, get this at");
  });

  it("renders links on their own line so Instagram linkifies them", () => {
    const text = renderOpeningDm(
      {
        openingMessage: "Follow for your guide: https://example.com/guide. Thanks!",
        buttonLabel: "OK",
      },
      {}
    );
    expect(text).toContain("\n\nhttps://example.com/guide\n");
  });
});
