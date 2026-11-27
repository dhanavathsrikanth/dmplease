/**
 * "Respond to all DMs" — account-level fallback reply.
 *
 * Pure module: normalizes stored config, validates, and builds the final
 * message. The webhook processor owns sending and persistence; tests can
 * exercise copy behaviour without mocking I/O.
 */

import { dmVariantsSchema } from "@/lib/validation/dm-variants";

import { buildDmVars, renderDmTemplate } from "@/lib/dm-variables";
import { formatDmText } from "@/lib/meta/dm-template";
import { z } from "zod";

export interface FallbackReplyConfig {
  enabled: boolean;
  message: string;
  variants: string[];
  oncePerDays: number;
  followGateEnabled: boolean;
  openingMessage: string | null;
  buttonLabel: string | null;
  onUnavailable: "hold" | "deliver";
  buttonText: string | null;
  buttonUrl: string | null;
}

export const FALLBACK_DEFAULTS = {
  message: "Thanks for reaching out! I'll get back to you soon. 🙌",
  oncePerDays: 1,
  buttonLabel: "I'm following ✅",
  openingMessage: "Hey {username}! Follow the account, then tap below so I can reply. 👇",
} as const;

export const FALLBACK_LIMITS = {
  messageMax: 1000,
  variantsMax: 10,
  variantMax: 500,
  oncePerDaysMin: 0,
  oncePerDaysMax: 365,
  buttonLabelMax: 20,
  openingMessageMax: 500,
} as const;

/** Zod schema shared by the server action and the editor. */
export const fallbackReplySchema = z.object({
  enabled: z.boolean().default(false),
  message: z.string().trim().max(FALLBACK_LIMITS.messageMax).default(""),
  variants: dmVariantsSchema,
  oncePerDays: z.coerce
    .number()
    .int()
    .min(FALLBACK_LIMITS.oncePerDaysMin)
    .max(FALLBACK_LIMITS.oncePerDaysMax)
    .default(1),
  followGateEnabled: z.boolean().default(false),
  openingMessage: z.string().trim().max(FALLBACK_LIMITS.openingMessageMax).default(""),
  buttonLabel: z.string().trim().max(FALLBACK_LIMITS.buttonLabelMax).default(""),
  onUnavailable: z.enum(["hold", "deliver"]).default("hold"),
  buttonText: z.string().trim().max(20).default(""),
  buttonUrl: z
    .union([z.literal(""), z.string().url("Enter a valid URL or leave this blank.")])
    .default(""),
});

export type FallbackReplyInput = z.input<typeof fallbackReplySchema>;

/** Normalizes a raw DB row into a usable config with honest defaults. */
export function normalizeFallbackReply(
  row?: {
    fallback_reply_enabled?: boolean | null;
    fallback_reply_message?: string | null;
    fallback_reply_variants?: string[] | null;
    fallback_once_per_days?: number | null;
    fallback_follow_gate_enabled?: boolean | null;
    fallback_opening_message?: string | null;
    fallback_follow_gate_button_label?: string | null;
    fallback_follow_gate_on_unavailable?: string | null;
    fallback_button_text?: string | null;
    fallback_button_url?: string | null;
  } | null
): FallbackReplyConfig {
  return {
    enabled: Boolean(row?.fallback_reply_enabled),
    message: row?.fallback_reply_message?.trim() || "",
    variants: (row?.fallback_reply_variants ?? []).filter(Boolean),
    oncePerDays: Math.max(0, Number(row?.fallback_once_per_days ?? 1)),
    followGateEnabled: Boolean(row?.fallback_follow_gate_enabled),
    openingMessage: row?.fallback_opening_message ?? null,
    buttonLabel: row?.fallback_follow_gate_button_label ?? null,
    onUnavailable:
      row?.fallback_follow_gate_on_unavailable === "deliver" ? "deliver" : "hold",
    buttonText: row?.fallback_button_text ?? null,
    buttonUrl: row?.fallback_button_url ?? null,
  };
}

/** Builds the final DM text for a fallback reply. */
export function buildFallbackMessage(
  config: FallbackReplyConfig,
  vars: { username?: string; link?: string; keyword?: string; name?: string; email?: string; phone?: string; voucher?: string; voucher_url?: string }
): string {
  const template = config.message || FALLBACK_DEFAULTS.message;
  const rendered = renderDmTemplate(template, buildDmVars(vars));
  return formatDmText(rendered, buildDmVars(vars));
}

/** True when the fallback should fire (enabled + has message). */
export function isFallbackEnabled(config: FallbackReplyConfig): boolean {
  return config.enabled && config.message.trim().length > 0;
}
