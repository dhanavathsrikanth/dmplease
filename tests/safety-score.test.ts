import { describe, expect, it } from "vitest";

import { computeSafetyScore } from "@/lib/meta/safety-score";

describe("safety score", () => {
  it("starts at 100 with no issues", () => {
    const result = computeSafetyScore({
      sent24h: 100,
      failed24h: 0,
      breaches24h: 0,
      throttles24h: 0,
      spikes24h: 0,
      optOuts24h: 0,
      gateExceptions24h: 0,
      consecutiveFailures: 0,
      tokenInvalid: false,
      safetyPaused: false,
      staleQueue: false,
    });
    expect(result.score).toBe(100);
    expect(result.band).toBe("excellent");
    expect(result.deductions).toHaveLength(0);
  });

  it("deducts for breaches, failures, token and pause", () => {
    const result = computeSafetyScore({
      sent24h: 50,
      failed24h: 10,
      breaches24h: 3,
      throttles24h: 0,
      spikes24h: 0,
      optOuts24h: 0,
      gateExceptions24h: 0,
      consecutiveFailures: 4,
      tokenInvalid: true,
      safetyPaused: true,
      staleQueue: true,
    });
    expect(result.score).toBeLessThan(40);
    expect(result.band).toBe("poor");
    const reasons = result.deductions.map((d) => d.reason);
    expect(reasons).toContain("Rate-limit breaches");
    expect(reasons).toContain("Instagram token invalid");
    expect(reasons).toContain("Safety paused");
  });

  it("never goes below 0 or above 100", () => {
    const result = computeSafetyScore({
      sent24h: 0,
      failed24h: 100,
      breaches24h: 100,
      throttles24h: 100,
      spikes24h: 100,
      optOuts24h: 100,
      gateExceptions24h: 100,
      consecutiveFailures: 100,
      tokenInvalid: true,
      safetyPaused: true,
      staleQueue: true,
    });
    expect(result.score).toBe(0);
  });

  it("reports the biggest deduction in the summary", () => {
    const result = computeSafetyScore({
      sent24h: 100,
      failed24h: 0,
      breaches24h: 5,
      throttles24h: 0,
      spikes24h: 0,
      optOuts24h: 0,
      gateExceptions24h: 0,
      consecutiveFailures: 0,
      tokenInvalid: false,
      safetyPaused: false,
      staleQueue: false,
    });
    expect(result.summary).toContain("Rate-limit breaches");
  });
});
