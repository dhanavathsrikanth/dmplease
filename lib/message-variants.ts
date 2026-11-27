/**
 * Generic message-variant engine.
 *
 * Pure and client-safe. Used for DM variants and public-reply variants so the
 * same rules apply everywhere: clean input, keep a stable fingerprint per
 * variant, and never pick one that was used recently.
 */

export interface VariantLimits {
  max: number;
  maxLength: number;
}

export interface VariantChoice {
  text: string;
  index: number;
  fingerprint: string;
}

function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function variantFingerprint(text: string): string {
  return fingerprint(text.trim());
}

/** Trims, deduplicates and caps a list of variant strings. */
export function normalizeVariants(
  variants: string[] | null | undefined,
  limits: VariantLimits,
  fallback: string[] = []
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const add = (raw: string) => {
    const value = raw.trim().slice(0, limits.maxLength);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return;
    seen.add(key);
    result.push(value);
  };
  for (const variant of variants ?? []) {
    add(variant);
    if (result.length >= limits.max) break;
  }
  if (result.length === 0) {
    for (const variant of fallback) add(variant);
  }
  return result.slice(0, limits.max);
}

/**
 * Picks a variant that has not been used recently.
 *
 * The `recent` list is scoped per automation/rule and shared across instances,
 * so consecutive repeats cannot happen just because two events landed on
 * different workers. Falls back to the whole list if everything was used.
 */
export function chooseVariant(
  variants: string[] | null | undefined,
  recentFingerprints: string[] = [],
  random: () => number = Math.random
): VariantChoice | null {
  const usable = (variants ?? []).filter((text) => text.trim().length > 0);
  if (usable.length === 0) return null;

  const entries = usable.map((text, index) => ({
    text,
    index,
    fingerprint: variantFingerprint(text),
  }));
  // Exclude at most N-1 recent variants so at least one candidate is always
  // fresh — with three variants, the previous two are never repeated.
  const recent = new Set(
    recentFingerprints.slice(-Math.max(0, entries.length - 1))
  );
  const fresh = entries.filter((entry) => !recent.has(entry.fingerprint));
  const candidates = fresh.length > 0 ? fresh : entries;
  const roll = Math.min(0.999999, Math.max(0, random()));
  return candidates[Math.floor(roll * candidates.length)] ?? entries[0];
}
