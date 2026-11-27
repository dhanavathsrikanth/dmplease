/** Shared validation for DM variants across campaigns, rules and fallback. */

import { z } from "zod";

import { DM_VARIANT_LIMITS } from "@/lib/dm-variants";

export const dmVariantsSchema = z
  .array(
    z
      .string()
      .trim()
      .max(
        DM_VARIANT_LIMITS.maxLength,
        `Keep each variant under ${DM_VARIANT_LIMITS.maxLength} characters`
      )
  )
  .max(DM_VARIANT_LIMITS.max, `Use at most ${DM_VARIANT_LIMITS.max} variants`)
  .default([]);
