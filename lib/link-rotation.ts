/**
 * Pure link-rotation decisions.
 *
 * `sticky` gives each follower a stable destination (trust + clean attribution);
 * `round_robin` spreads sends evenly across destinations (simple A/B split).
 * No I/O here so the rules can be tested and reused by previews.
 */

export type LinkRotationMode = "sticky" | "round_robin";

export interface RotationTarget {
  id: string;
  enabled: boolean;
  position?: number;
}

export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function selectTargetIndex(input: {
  targets: RotationTarget[];
  mode: LinkRotationMode;
  scopeKey: string;
  recipientId: string;
  counter?: number;
}): number {
  const enabled = input.targets
    .filter((target) => target.enabled)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  if (enabled.length === 0) return -1;

  if (input.mode === "round_robin") {
    const counter = Math.max(0, Math.floor(input.counter ?? 0));
    return counter % enabled.length;
  }

  // Sticky: deterministic per recipient and rotator, stable across workers.
  return hashString(`${input.scopeKey}:${input.recipientId}`) % enabled.length;
}
