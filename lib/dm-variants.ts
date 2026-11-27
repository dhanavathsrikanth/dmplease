/** Shared limits and normalisation for DM message variants. */

import { normalizeVariants } from "@/lib/message-variants";

export const DM_VARIANT_LIMITS = {
  max: 10,
  maxLength: 1000,
  /** Below two variants, rotation is impossible — the UI says so plainly. */
  minForRotation: 2,
} as const;

/**
 * Returns clean variants, falling back to the primary message when none are
 * configured (so existing campaigns keep sending exactly what they did before).
 */
export function normalizeDmVariants(
  variants: string[] | null | undefined,
  primaryMessage: string
): string[] {
  return normalizeVariants(
    variants,
    {
      max: DM_VARIANT_LIMITS.max,
      maxLength: DM_VARIANT_LIMITS.maxLength,
    },
    [primaryMessage]
  );
}
