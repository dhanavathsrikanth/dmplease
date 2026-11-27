/**
 * Public comment replies — shared, client-safe vocabulary and pure helpers.
 *
 * A public reply is posted under a comment after its DM is delivered. Rotating
 * between several natural variants is what keeps those replies from looking
 * identical to Instagram (and to the people reading the thread).
 */

import { personalizeMessage } from "@/lib/meta/dm-template";
import {
  chooseVariant,
  normalizeVariants,
  variantFingerprint,
} from "@/lib/message-variants";

export const PUBLIC_REPLY_LIMITS = {
  maxMessages: 10,
  messageMax: 500,
  /** Never run a public reply with fewer than this many natural variants. */
  minVariants: 3,
  /** How many recently used variants we remember per automation. */
  recentHistory: 3,
} as const;

/**
 * Natural, varied defaults. A single "Sent you a DM!" pasted under every
 * comment is the exact spam signal this feature exists to avoid.
 */
export const PUBLIC_REPLY_DEFAULTS = [
  "Sent you a DM! 📩",
  "Just sent it over to your inbox 👇",
  "Check your DMs — I've shared it there! 🙌",
  "Done — it's in your DM, {username}! ✅",
  "Got it! I've messaged you with the details ✨",
] as const;

/** Backwards-compatible alias for callers that need one example string. */
export const PUBLIC_REPLY_DEFAULT = PUBLIC_REPLY_DEFAULTS[0];

/** Stable identity for a variant, independent of the person it is sent to. */
export function publicReplyFingerprint(text: string): string {
  return variantFingerprint(text);
}

/**
 * Cleans stored variants and guarantees a varied default set.
 *
 * Blanks and duplicates are removed, each entry is capped at the shared
 * length limit, and the list is topped up with natural defaults until it has
 * at least `minVariants`. This applies at runtime *and* in the editor, so an
 * old campaign with one stored reply immediately stops repeating itself.
 */
export function normalizePublicReplies(messages: string[] | null | undefined): string[] {
  const cleaned = normalizeVariants(messages, {
    max: PUBLIC_REPLY_LIMITS.maxMessages,
    maxLength: PUBLIC_REPLY_LIMITS.messageMax,
  });
  const result = [...cleaned];
  if (result.length >= PUBLIC_REPLY_LIMITS.minVariants) return result;
  for (const fallback of PUBLIC_REPLY_DEFAULTS) {
    if (result.some((item) => item.toLowerCase() === fallback.toLowerCase())) continue;
    result.push(fallback);
    if (result.length >= PUBLIC_REPLY_LIMITS.minVariants) break;
  }
  return result;
}

export interface PublicReplyChoice {
  message: string;
  index: number;
  fingerprint: string;
}

/**
 * Picks a variant that was NOT recently used.
 *
 * Recent fingerprints are excluded first; if everyone in the list was used
 * recently we fall back to the full list, so the feature can never get stuck.
 * A pure function with injectable `random` keeps this deterministic in tests.
 */
export function choosePublicReply(
  variants: string[] | null | undefined,
  recentFingerprints: string[] = [],
  random: () => number = Math.random
): PublicReplyChoice {
  const chosen = chooseVariant(
    normalizePublicReplies(variants),
    recentFingerprints.slice(-PUBLIC_REPLY_LIMITS.recentHistory),
    random
  );
  if (!chosen) {
    return {
      message: PUBLIC_REPLY_DEFAULT,
      index: 0,
      fingerprint: publicReplyFingerprint(PUBLIC_REPLY_DEFAULT),
    };
  }
  return {
    message: chosen.text,
    index: chosen.index,
    fingerprint: chosen.fingerprint,
  };
}

/** Simple random pick (no history) for callers that do not track state. */
export function selectPublicReply(
  variants: string[] | null | undefined,
  random: () => number = Math.random
): string {
  return choosePublicReply(variants, [], random).message;
}

export interface PublicReplyVars {
  username?: string;
  keyword?: string;
  link?: string;
}

/** Final text sent to the Graph API. Uses the same placeholders as the DM. */
export function renderPublicReply(
  template: string,
  vars: PublicReplyVars = {}
): string {
  return personalizeMessage(template, vars).trim();
}
