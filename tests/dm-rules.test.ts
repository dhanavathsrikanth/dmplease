import { describe, expect, it } from "vitest";
import {
  fallbackAsRule,
  matchesRuleKeyword,
  matchesRuleKeywords,
  normalizeFallbackReply,
  selectInboundRule,
  type DispatchRule,
} from "@/lib/dm-rules";

function rule(partial: Partial<DispatchRule> & { id: string }): DispatchRule {
  return {
    name: partial.id,
    trigger_type: "DM_KEYWORD",
    keywords: [],
    message: `Reply ${partial.id}`,
    variants: [],
    button_text: null,
    button_url: null,
    collect_field: null,
    follow_gate_enabled: false,
    opening_message: null,
    follow_gate_button_label: null,
    follow_gate_on_unavailable: "hold",
    once_per_days: 45,
    priority: 0,
    ...partial,
  };
}

describe("DM keyword matching", () => {
  it("matches whole tokens only", () => {
    expect(matchesRuleKeyword("What is the PRICE?", "price")).toBe(true);
    expect(matchesRuleKeyword("pricing plans", "price")).toBe(false);
    expect(matchesRuleKeyword("a price-list today", "price")).toBe(true);
  });

  it("supports multi-word phrases across whitespace", () => {
    expect(matchesRuleKeyword("send me the PRICE  LIST please", "price list")).toBe(true);
    expect(matchesRuleKeyword("list of prices", "price list")).toBe(false);
  });

  it("treats blank keywords as match-all", () => {
    expect(matchesRuleKeywords([], "anything")).toBe(true);
    expect(matchesRuleKeyword("anything", "  ")).toBe(true);
  });

  it("handles regex characters safely", () => {
    expect(matchesRuleKeyword("Is this (safe)?", "(safe)")).toBe(true);
    expect(matchesRuleKeyword("safe", "(safe)")).toBe(false);
  });
});

describe("deterministic inbound rule selection", () => {
  const specificLow = rule({ id: "specific-low", keywords: ["guide"], priority: 1 });
  const specificHigh = rule({ id: "specific-high", keywords: ["vip"], priority: 9 });
  const catchAll = rule({ id: "catch", priority: 100 });
  const catchAllLow = rule({ id: "catch-low", priority: -5 });
  const rules = [catchAll, specificLow, specificHigh, catchAllLow];

  it("always prefers a keyword rule over a higher-priority catch-all", () => {
    const selection = selectInboundRule(rules, "send me the GUIDE");
    expect(selection.rule?.id).toBe("specific-low");
    expect(selection.matchedKeyword).toBe("guide");
    expect(selection.catchAll).toBe(false);
  });

  it("orders specific rules by priority", () => {
    expect(selectInboundRule(rules, "vip and guide").rule?.id).toBe("specific-high");
  });

  it("uses the highest-priority catch-all only when nothing matched", () => {
    const selection = selectInboundRule(rules, "just hello");
    expect(selection.rule?.id).toBe("catch");
    expect(selection.catchAll).toBe(true);
    expect(selection.matchedKeyword).toBeNull();
  });

  it("returns no rule when nothing is configured", () => {
    expect(selectInboundRule([], "hello").rule).toBeNull();
  });
});

describe("Respond to all DMs fallback", () => {
  it("normalizes an off/unconfigured account safely", () => {
    const config = normalizeFallbackReply(null);
    expect(config.enabled).toBe(false);
    expect(config.oncePerDays).toBe(45);
    expect(config.onUnavailable).toBe("hold");
    expect(config.variants).toEqual([]);
  });

  it("preserves configured copy, variants and gate policy", () => {
    const config = normalizeFallbackReply({
      fallback_reply_enabled: true,
      fallback_reply_message: "Here you go",
      fallback_reply_variants: ["A", "B"],
      fallback_once_per_days: 7,
      fallback_follow_gate_enabled: true,
      fallback_follow_gate_on_unavailable: "deliver",
    });
    expect(config.enabled).toBe(true);
    expect(config.variants).toEqual(["A", "B"]);
    expect(config.oncePerDays).toBe(7);
    expect(config.followGateEnabled).toBe(true);
    expect(config.onUnavailable).toBe("deliver");
  });

  it("builds a virtual rule that can never outrank a real rule", () => {
    const config = normalizeFallbackReply({
      fallback_reply_enabled: true,
      fallback_reply_message: "Fallback copy",
      fallback_follow_gate_enabled: true,
    });
    const virtual = fallbackAsRule(config, "acc-1");
    expect(virtual.id).toBe("fallback:acc-1");
    expect(virtual.priority).toBe(-1);
    expect(virtual.keywords).toEqual([]);
    expect(virtual.follow_gate_enabled).toBe(true);
    expect(virtual.message).toBe("Fallback copy");

    const realCatchAll = rule({ id: "real-catch", priority: -100 });
    expect(selectInboundRule([virtual, realCatchAll], "anything").rule?.id).toBe(
      "real-catch"
    );
  });
});
