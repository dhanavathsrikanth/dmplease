/**
 * Shared validation for follow-up step configuration.
 *
 * Used by the server action before any write and by the editor for inline
 * feedback, so an invalid step can never reach the cron engine.
 */

import { z } from "zod";

import { FOLLOWUP_LIMITS } from "@/lib/followup-constants";

export const followupStepSchema = z.object({
  step: z.number().int().min(1).max(FOLLOWUP_LIMITS.maxSteps),
  delayMinutes: z
    .number()
    .int()
    .min(
      FOLLOWUP_LIMITS.minDelayMinutes,
      `Wait at least ${FOLLOWUP_LIMITS.minDelayMinutes} minutes`
    )
    .max(
      FOLLOWUP_LIMITS.maxDelayMinutes,
      `Wait at most ${FOLLOWUP_LIMITS.maxDelayMinutes} minutes`
    ),
  message: z
    .string()
    .trim()
    .min(1, "Write the follow-up message")
    .max(FOLLOWUP_LIMITS.messageMax, "Keep the message under 1000 characters"),
  enabled: z.boolean().default(true),
  holdoutPercent: z
    .number()
    .int()
    .min(FOLLOWUP_LIMITS.minHoldoutPercent)
    .max(FOLLOWUP_LIMITS.maxHoldoutPercent),
});

export const followupStepsSchema = z
  .array(followupStepSchema)
  .max(FOLLOWUP_LIMITS.maxSteps)
  .superRefine((steps, ctx) => {
    const seen = new Set<number>();
    for (const [index, step] of steps.entries()) {
      if (seen.has(step.step)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "step"],
          message: "Each follow-up needs a unique step number",
        });
      }
      seen.add(step.step);
    }
  });

export type FollowupStepInput = z.input<typeof followupStepSchema>;
