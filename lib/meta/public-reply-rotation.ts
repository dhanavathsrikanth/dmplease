/**
 * Public-reply rotation history.
 *
 * Thin, named wrapper over the shared variant-history store so public replies
 * and DM variants cannot accidentally share the same bucket.
 */

import {
  getRecentVariantFingerprints,
  recordVariantFingerprint,
} from "@/lib/meta/variant-history";

function scope(automationId: string): string {
  return `publicreply:${automationId}`;
}

export async function getRecentPublicReplyFingerprints(
  automationId: string
): Promise<string[]> {
  return getRecentVariantFingerprints(scope(automationId));
}

export async function recordPublicReplyFingerprint(
  automationId: string,
  fingerprint: string,
  recent: string[] = []
): Promise<void> {
  await recordVariantFingerprint(scope(automationId), fingerprint, recent);
}
