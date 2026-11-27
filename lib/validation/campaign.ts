import { z } from "zod";

import { AUTO_REEL_LINK } from "@/lib/reel-link";
import {
  followGateButtonLabelSchema,
  openingMessageSchema,
} from "@/lib/validation/follow-gate";
import { publicRepliesSchema } from "@/lib/validation/public-replies";
import { dmVariantsSchema } from "@/lib/validation/dm-variants";
import {
  messageAssetsSchema,
  messageFormatSchema,
} from "@/lib/validation/message-formats";

/** Shared validation for campaign creation (server action + tests). */
export const campaignSchema = z.object({
  name: z.string().trim().min(1, "Give the campaign a name").max(80),
  goal: z.string().trim().max(60).optional(),
  postScope: z.enum(["ANY_POST", "SPECIFIC_POST", "NEXT_POST"]),
  postId: z.string().trim().max(255).nullable().optional(),
  postThumbnailUrl: z
    .string()
    .trim()
    .max(2000)
    .nullable()
    .optional()
    .refine((value) => !value || /^https?:\/\//i.test(value), {
      message: "Thumbnail URL must start with http:// or https://",
    }),
  postCaption: z.string().max(2200).nullable().optional(),
  triggerKeywords: z
    .array(z.string().trim().min(1).max(40))
    .max(20, "Use at most 20 keywords")
    .default([]),
  dmMessage: z
    .string()
    .trim()
    .min(1, "Write the DM message")
    .max(1000, "Keep the DM under 1000 characters"),
  /** Rotated at send time; empty means only dmMessage is used. */
  dmVariants: dmVariantsSchema,
  messageFormat: messageFormatSchema.default("text"),
  messageAssets: messageAssetsSchema.nullable().optional(),
  /** Smart short links with optional rotation across destinations. */
  shortLinksEnabled: z.boolean().default(false),
  linkRotatorId: z.string().uuid().nullable().optional(),
  buttonText: z.string().trim().max(20).nullable().optional(),
  buttonUrl: z
    .string()
    .trim()
    .max(2000)
    .nullable()
    .optional()
    .refine(
      (value) =>
        !value ||
        value.toLowerCase() === AUTO_REEL_LINK.toLowerCase() ||
        /^https?:\/\//i.test(value),
      {
        message: `Button URL must start with http:// or https:// (or use ${AUTO_REEL_LINK} to attach the reel automatically)`,
      }
    ),
  publicReplyEnabled: z.boolean().default(false),
  publicReplyMessages: publicRepliesSchema,
  /** Lead field collected with a reply so it can be interpolated later. */
  collectField: z.enum(["none", "email", "phone", "name"]).default("none"),
  followGateEnabled: z.boolean().default(false),
  /** Ask-for-Follow: copy shown before Meta can confirm the relationship. */
  openingMessage: openingMessageSchema.nullable().optional(),
  followGateButtonLabel: followGateButtonLabelSchema.nullable().optional(),
  followGateOnUnavailable: z.enum(["hold", "deliver"]).default("hold"),
});

export type ValidCampaign = z.infer<typeof campaignSchema>;

export interface CampaignValidationResult {
  success: boolean;
  data?: ValidCampaign;
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

export function validateCampaign(input: unknown): CampaignValidationResult {
  const parsed = campaignSchema.safeParse(input);
  if (parsed.success) return { success: true, data: parsed.data };

  const fieldErrors: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? "form");
    (fieldErrors[key] ??= []).push(issue.message);
  }

  const first = parsed.error.issues[0];
  return {
    success: false,
    fieldErrors,
    error: first ? `${first.path.join(".") || "Campaign"}: ${first.message}` : "Invalid campaign",
  };
}
