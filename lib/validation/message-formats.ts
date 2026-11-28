/** Validation for stored rich-format configuration. */

import { z } from "zod";

import { MESSAGE_FORMAT_IDS } from "@/lib/message-formats";

const urlOrEmpty = z
  .string()
  .max(2000)
  .refine((value) => !value || /^https?:\/\//i.test(value), "Enter a valid URL");

export const storedAssetSchema = z.object({
  url: z.string().url(),
  key: z.string().max(1000).optional(),
  mimeType: z.string().max(120).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  filename: z.string().max(255).optional(),
});

export const cardElementSchema = z.object({
  title: z.string().trim().min(1).max(80),
  subtitle: z.string().trim().max(80).optional(),
  imageUrl: urlOrEmpty.optional(),
  buttonText: z.string().trim().max(20).optional(),
  buttonUrl: urlOrEmpty.optional(),
});

export const messageFormatSchema = z.enum(
  MESSAGE_FORMAT_IDS as [string, ...string[]]
);

export const linkElementSchema = z.object({
  title: z.string().trim().max(80).optional(),
  url: urlOrEmpty,
});

export const messageAssetsSchema = z.object({
  format: messageFormatSchema,
  text: z.string().max(1000).optional(),
  asset: storedAssetSchema.nullable().optional(),
  cards: z.array(cardElementSchema).max(10).optional(),
  links: z.array(linkElementSchema).max(10).optional(),
  publicReplyLimit: z.number().int().min(0).max(10000).optional(),
  collectQuestion: z.string().trim().max(500).optional(),
  collectAllowSkip: z.boolean().optional(),
  collectCustomProperty: z
    .object({
      key: z.string().trim().min(1).max(60),
      question: z.string().trim().min(1).max(500),
      type: z.enum(["options", "yes_no", "text"]),
      options: z.array(z.string().trim().min(1).max(80)).max(20),
    })
    .optional(),
});
