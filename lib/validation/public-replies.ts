/** Shared validation for the public-reply variants saved with a campaign. */

import { z } from "zod";

import { PUBLIC_REPLY_LIMITS } from "@/lib/public-replies";

export const publicRepliesSchema = z
  .array(
    z
      .string()
      .trim()
      .max(
        PUBLIC_REPLY_LIMITS.messageMax,
        `Keep each public reply under ${PUBLIC_REPLY_LIMITS.messageMax} characters`
      )
  )
  .max(
    PUBLIC_REPLY_LIMITS.maxMessages,
    `Use at most ${PUBLIC_REPLY_LIMITS.maxMessages} public replies`
  )
  .default([]);
