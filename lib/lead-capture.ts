/**
 * T1.7: Lead capture primitives.
 *
 * Pure, testable helpers shared by the webhook processor, the campaign builder
 * and the phone preview. Keeping validation in one place means the preview and
 * the live DM can never disagree about what counts as a valid email or phone.
 */

export type CollectFieldKind = "email" | "phone" | "name" | "custom";

export interface CollectField {
  kind: CollectFieldKind;
  /** Custom property key when kind === "custom". */
  key: string | null;
  /** Original stored value, e.g. "email" or "custom:company". */
  raw: string;
}

export interface CollectConfig {
  retryMessage: string;
  skipMessage: string;
  successMessage: string;
  skipKeywords: string[];
  maxAttempts: number;
}

export const DEFAULT_COLLECT_CONFIG: CollectConfig = {
  retryMessage:
    "That doesn't look quite right. Please try again, or reply SKIP to continue.",
  skipMessage: "No problem — I'll skip that. Here's everything else you need.",
  successMessage: "Got it, thank you! ✅",
  skipKeywords: ["skip", "later", "no thanks", "not now"],
  maxAttempts: 3,
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const NAME_RE = /^[\p{L}][\p{L}\p{M}' .-]{0,79}$/u;

/** Parses `email`, `phone`, `name` or `custom:<key>`. */
export function parseCollectField(
  raw: string | null | undefined
): CollectField | null {
  const value = (raw ?? "").trim();
  if (!value || value === "none") return null;
  if (value === "email" || value === "phone" || value === "name") {
    return { kind: value, key: null, raw: value };
  }
  if (value.startsWith("custom:")) {
    const key = value.slice("custom:".length).trim();
    if (!key) return null;
    return { kind: "custom", key, raw: value };
  }
  // Unknown legacy value: treat it as a custom property key.
  return { kind: "custom", key: value, raw: value };
}

export function collectFieldLabel(field: CollectField | null): string {
  if (!field) return "Nothing";
  if (field.kind === "email") return "Email address";
  if (field.kind === "phone") return "Phone number";
  if (field.kind === "name") return "Name";
  return field.key ? `Custom: ${field.key}` : "Custom property";
}

export interface LeadValidation {
  valid: boolean;
  normalized: string;
  error: string | null;
}

/** Validates and normalizes a follower's reply for the requested field. */
export function validateLeadValue(
  kind: CollectFieldKind,
  value: string
): LeadValidation {
  const trimmed = value.trim();
  if (!trimmed) {
    return { valid: false, normalized: "", error: "That reply was empty." };
  }

  if (kind === "email") {
    const normalized = trimmed.toLowerCase();
    if (!EMAIL_RE.test(normalized)) {
      return {
        valid: false,
        normalized,
        error: "That doesn't look like a valid email address.",
      };
    }
    return { valid: true, normalized, error: null };
  }

  if (kind === "phone") {
    const normalized = trimmed.replace(/[\s().-]/g, "");
    if (!/^\+?\d{7,15}$/.test(normalized)) {
      return {
        valid: false,
        normalized,
        error: "That doesn't look like a valid phone number.",
      };
    }
    return { valid: true, normalized, error: null };
  }

  if (kind === "name") {
    if (!NAME_RE.test(trimmed)) {
      return {
        valid: false,
        normalized: trimmed,
        error: "Please reply with just your name.",
      };
    }
    return { valid: true, normalized: trimmed, error: null };
  }

  // Custom property: accept any non-empty value up to 200 characters.
  if (trimmed.length > 200) {
    return {
      valid: false,
      normalized: trimmed.slice(0, 200),
      error: "That reply is too long. Please keep it under 200 characters.",
    };
  }
  return { valid: true, normalized: trimmed, error: null };
}

/** True when the reply is an explicit opt-out from the collect step. */
export function isSkipKeyword(
  text: string,
  keywords: string[] = DEFAULT_COLLECT_CONFIG.skipKeywords
): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!?]+$/, "");
  if (!normalized) return false;
  return keywords.some((keyword) => {
    const k = keyword.trim().toLowerCase();
    if (!k) return false;
    return normalized === k || normalized.startsWith(`${k} `);
  });
}

/** The question sent to the follower when the collect step starts. */
export function renderCollectPrompt(
  field: CollectField,
  config: CollectConfig = DEFAULT_COLLECT_CONFIG
): string {
  const label =
    field.kind === "email"
      ? "email address"
      : field.kind === "phone"
        ? "phone number"
        : field.kind === "name"
          ? "name"
          : field.key ?? "detail";
  const skip = config.skipKeywords[0] ?? "skip";
  return `Reply with your ${label} to finish. Reply ${skip.toUpperCase()} to skip.`;
}

/** Merges stored values with defaults and clamps the attempt count. */
export function normalizeCollectConfig(input: {
  retryMessage?: string | null;
  skipMessage?: string | null;
  successMessage?: string | null;
  skipKeywords?: string[] | null;
  maxAttempts?: number | null;
}): CollectConfig {
  const keywords = (input.skipKeywords ?? [])
    .map((keyword) => keyword.trim())
    .filter(Boolean);
  return {
    retryMessage: input.retryMessage?.trim() || DEFAULT_COLLECT_CONFIG.retryMessage,
    skipMessage: input.skipMessage?.trim() || DEFAULT_COLLECT_CONFIG.skipMessage,
    successMessage:
      input.successMessage?.trim() || DEFAULT_COLLECT_CONFIG.successMessage,
    skipKeywords:
      keywords.length > 0 ? keywords : DEFAULT_COLLECT_CONFIG.skipKeywords,
    maxAttempts: Math.min(
      10,
      Math.max(1, Math.round(input.maxAttempts ?? DEFAULT_COLLECT_CONFIG.maxAttempts))
    ),
  };
}
