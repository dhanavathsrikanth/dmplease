/**
 * Composite safety score.
 *
 * Pure and deterministic: turns measured facts (delivery rate, breaches,
 * consecutive failures, token health, opt-outs, throttles) into a single
 * 0–100 number and a human-readable band. No I/O, no framework imports, so it
 * can be unit-tested and reused by the dashboard and any future alerting.
 */

export type SafetyBand = "excellent" | "good" | "fair" | "poor";

export interface SafetyInputs {
  /** DMs sent in the last 24h. */
  sent24h: number;
  /** DMs that failed in the last 24h. */
  failed24h: number;
  /** Rate-limit breaches in the last 24h. */
  breaches24h: number;
  /** Viral throttle events in the last 24h. */
  throttles24h: number;
  /** Viral spike detections in the last 24h. */
  spikes24h: number;
  /** Opt-outs in the last 24h. */
  optOuts24h: number;
  /** Follow-gate exceptions in the last 24h. */
  gateExceptions24h: number;
  /** Consecutive failures on the connected account. */
  consecutiveFailures: number;
  /** Whether the connected token is invalid. */
  tokenInvalid: boolean;
  /** Whether safety is manually paused. */
  safetyPaused: boolean;
  /** Whether the queue has pending items older than 1 hour. */
  staleQueue: boolean;
}

export interface SafetyResult {
  score: number;
  band: SafetyBand;
  /** Human-readable label for the band. */
  label: string;
  /** One-line explanation of the biggest factor. */
  summary: string;
  /** Breakdown of point deductions. */
  deductions: Array<{ reason: string; points: number }>;
}

const BAND_LABELS: Record<SafetyBand, string> = {
  excellent: "Excellent",
  good: "Good",
  fair: "Fair",
  poor: "Poor",
};

export function computeSafetyScore(input: SafetyInputs): SafetyResult {
  const deductions: Array<{ reason: string; points: number }> = [];
  let score = 100;

  // Delivery rate (up to -30)
  const total = input.sent24h + input.failed24h;
  if (total > 0) {
    const deliveryRate = input.sent24h / total;
    if (deliveryRate < 0.95) {
      const points = Math.round((0.95 - deliveryRate) * 100);
      const capped = Math.min(30, points);
      score -= capped;
      deductions.push({ reason: "Low delivery rate", points: capped });
    }
  }

  // Rate-limit breaches (up to -25)
  if (input.breaches24h > 0) {
    const points = Math.min(25, input.breaches24h * 5);
    score -= points;
    deductions.push({ reason: "Rate-limit breaches", points });
  }

  // Token health (-25)
  if (input.tokenInvalid) {
    score -= 25;
    deductions.push({ reason: "Instagram token invalid", points: 25 });
  }

  // Consecutive failures (up to -20)
  if (input.consecutiveFailures > 0) {
    const points = Math.min(20, input.consecutiveFailures * 4);
    score -= points;
    deductions.push({ reason: "Consecutive send failures", points });
  }

  // Viral throttles (up to -10)
  if (input.throttles24h > 0) {
    const points = Math.min(10, input.throttles24h * 2);
    score -= points;
    deductions.push({ reason: "Viral-spike throttling", points });
  }

  // Opt-outs (up to -10)
  if (input.optOuts24h > 0 && total > 0) {
    const optOutRate = input.optOuts24h / total;
    if (optOutRate > 0.02) {
      const points = Math.min(10, Math.round(optOutRate * 100));
      score -= points;
      deductions.push({ reason: "High opt-out rate", points });
    }
  }

  // Stale queue (-5)
  if (input.staleQueue) {
    score -= 5;
    deductions.push({ reason: "Stale DM queue", points: 5 });
  }

  // Safety paused (-15)
  if (input.safetyPaused) {
    score -= 15;
    deductions.push({ reason: "Safety paused", points: 15 });
  }

  // Viral spikes (informational, small deduction)
  if (input.spikes24h > 5) {
    const points = Math.min(5, input.spikes24h);
    score -= points;
    deductions.push({ reason: "Frequent viral spikes", points });
  }

  score = Math.max(0, Math.min(100, score));

  let band: SafetyBand;
  if (score >= 80) band = "excellent";
  else if (score >= 60) band = "good";
  else if (score >= 40) band = "fair";
  else band = "poor";

  // Summary: biggest deduction first.
  const biggest = deductions.sort((a, b) => b.points - a.points)[0];
  const summary =
    deductions.length === 0
      ? "All safety signals are healthy."
      : biggest
        ? `Biggest factor: ${biggest.reason} (-${biggest.points}).`
        : "All safety signals are healthy.";

  return {
    score,
    band,
    label: BAND_LABELS[band],
    summary,
    deductions,
  };
}
