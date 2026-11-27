/**
 * Client-safe limits and defaults for 24h follow-ups.
 *
 * No server imports here: the campaign UI and the cron engine must agree on
 * the same numbers. Rendering defaults are also defined here so a fresh step
 * is useful without any extra typing.
 */

export const FOLLOWUP_LIMITS = {
  maxSteps: 3,
  minDelayMinutes: 60,
  maxDelayMinutes: 10080,
  messageMax: 1000,
  minHoldoutPercent: 0,
  maxHoldoutPercent: 100,
} as const;

export const FOLLOWUP_DEFAULTS = {
  step: 1,
  /** One day after the opt-in / first DM — the feature's namesake. */
  delayMinutes: 1440,
  message:
    "Hey {username}! Just checking in — did you get everything you needed? Reply if you have any questions. 🙌",
  enabled: true,
  /** A small holdout makes lift measurable without withholding much audience. */
  holdoutPercent: 10,
} as const;

/** `cancelled` is written when a click or reply makes a follow-up unnecessary. */
export const FOLLOWUP_ACTIONS = [
  "sent",
  "held_out",
  "converted",
  "opted_out",
  "cancelled",
] as const;

export type FollowupAction = (typeof FOLLOWUP_ACTIONS)[number];

export function followupStepLabel(step: number): string {
  return `Follow-up #${step}`;
}

/** Human delay used in the editor and in the report. */
export function formatDelay(minutes: number): string {
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${minutes} min`;
}
