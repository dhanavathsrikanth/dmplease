import { createHash } from "crypto";

/** Stable bucket so the same follower is consistently held out or messaged. */
export function inHoldout(
  recipientId: string,
  step: number,
  percent: number
): boolean {
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  const hash = createHash("sha256").update(`${recipientId}:${step}`).digest("hex");
  return parseInt(hash.slice(0, 4), 16) % 100 < percent;
}
