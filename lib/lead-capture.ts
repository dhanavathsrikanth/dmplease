/**
 * T1.7: Lead capture primitives.
 *
 * Pure, testable helpers shared by the webhook processor, the campaign builder
 * and the phone preview. Keeping validation in one place means the preview and
 * the live DM can never disagree about what counts as a valid email or phone.
 */

export type CollectFieldKind =
  | "email"
  | "phone"
  | "name"
  | "gender"
  | "age_group"
  | "custom";

export const GENDER_OPTIONS = ["Male", "Female", "Others"] as const;

export const AGE_GROUP_OPTIONS = [
  "Under 18",
  "18-24",
  "25-34",
  "35-44",
  "45-54",
  "55-64",
  "65+",
] as const;

export interface CollectField {
  kind: CollectFieldKind;
  /** Custom property key when kind === "custom". */
  key: string | null;
  /** Original stored value, e.g. "email" or "custom:company". */
  raw: string;
}

export interface CollectConfig {
  /** Optional custom question shown to the follower. */
  question?: string;
  retryMessage: string;
  skipMessage: string;
  successMessage: string;
  skipKeywords: string[];
  maxAttempts: number;
  /** When false, the follower cannot skip the question. */
  allowSkip: boolean;
  /** Definition for a custom property (options, yes/no, or free text). */
  customProperty?: {
    type: "options" | "yes_no" | "text";
    options: string[];
  };
}

export const DEFAULT_COLLECT_CONFIG: CollectConfig = {
  retryMessage:
    "That doesn't look quite right. Please try again, or reply SKIP to continue.",
  skipMessage: "No problem — I'll skip that. Here's everything else you need.",
  successMessage: "Got it, thank you! ✅",
  skipKeywords: ["skip", "later", "no thanks", "not now"],
  maxAttempts: 3,
  allowSkip: true,
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const NAME_RE = /^[\p{L}][\p{L}\p{M}' .-]{0,79}$/u;

/** Parses `email`, `phone`, `name` or `custom:<key>`. */
export function parseCollectField(
  raw: string | null | undefined
): CollectField | null {
  const value = (raw ?? "").trim();
  if (!value || value === "none") return null;
  if (
    value === "email" ||
    value === "phone" ||
    value === "name" ||
    value === "gender" ||
    value === "age_group"
  ) {
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
  if (field.kind === "gender") return "Gender";
  if (field.kind === "age_group") return "Age group";
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
  value: string,
  customProperty?: CollectConfig["customProperty"]
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

  if (kind === "gender") {
    const normalized = trimmed.toLowerCase();
    const match = GENDER_OPTIONS.find(
      (option) => option.toLowerCase() === normalized
    );
    if (!match) {
      return {
        valid: false,
        normalized: trimmed,
        error: "Please reply with Male, Female, or Others.",
      };
    }
    return { valid: true, normalized: match, error: null };
  }

  if (kind === "age_group") {
    const normalized = trimmed.replace(/\s+/g, " ").toLowerCase();
    const match = AGE_GROUP_OPTIONS.find(
      (option) => option.toLowerCase() === normalized
    );
    if (!match) {
      return {
        valid: false,
        normalized: trimmed,
        error: `Please reply with one of: ${AGE_GROUP_OPTIONS.join(", ")}.`,
      };
    }
    return { valid: true, normalized: match, error: null };
  }

  // Custom property: validate against the configured answer type.
  if (customProperty?.type === "yes_no") {
    const normalized = trimmed.toLowerCase();
    if (normalized === "yes" || normalized === "y") {
      return { valid: true, normalized: "Yes", error: null };
    }
    if (normalized === "no" || normalized === "n") {
      return { valid: true, normalized: "No", error: null };
    }
    return {
      valid: false,
      normalized: trimmed,
      error: "Please reply with Yes or No.",
    };
  }

  if (customProperty?.type === "options" && customProperty.options.length > 0) {
    const normalized = trimmed.toLowerCase();
    const match = customProperty.options.find(
      (option) => option.toLowerCase() === normalized
    );
    if (!match) {
      return {
        valid: false,
        normalized: trimmed,
        error: `Please reply with one of: ${customProperty.options.join(", ")}.`,
      };
    }
    return { valid: true, normalized: match, error: null };
  }

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
  keywords: string[] = DEFAULT_COLLECT_CONFIG.skipKeywords,
  allowSkip = true
): boolean {
  if (!allowSkip) return false;
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
  const custom = config.question?.trim();
  if (custom) return custom;
  const label =
    field.kind === "email"
      ? "email address"
      : field.kind === "phone"
        ? "phone number"
        : field.kind === "name"
          ? "name"
          : field.kind === "gender"
            ? "gender (Male, Female, or Others)"
            : field.kind === "age_group"
              ? `age group (${AGE_GROUP_OPTIONS.join(", ")})`
              : field.key ?? "detail";
  const skip = config.skipKeywords[0] ?? "skip";
  return config.allowSkip
    ? `Reply with your ${label} to finish. Reply ${skip.toUpperCase()} to skip.`
    : `Reply with your ${label} to finish.`;
}

/** Merges stored values with defaults and clamps the attempt count. */
export function normalizeCollectConfig(input: {
  question?: string | null;
  retryMessage?: string | null;
  skipMessage?: string | null;
  successMessage?: string | null;
  skipKeywords?: string[] | null;
  maxAttempts?: number | null;
  allowSkip?: boolean | null;
  customProperty?: CollectConfig["customProperty"] | null;
}): CollectConfig {
  const keywords = (input.skipKeywords ?? [])
    .map((keyword) => keyword.trim())
    .filter(Boolean);
  return {
    question: input.question?.trim() || undefined,
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
    allowSkip: input.allowSkip ?? DEFAULT_COLLECT_CONFIG.allowSkip,
    customProperty: input.customProperty ?? undefined,
  };
}
