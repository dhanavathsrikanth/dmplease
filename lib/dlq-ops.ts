import { cleanEnv } from "@/lib/config";
import { getQstash, getQstashWorkerUrl, hasQstash } from "@/lib/upstash";

/** Thin wrapper over QStash's dead-letter queue for the admin console. */

interface DlqItem {
  dlqId: string;
  messageId?: string;
  url?: string;
  responseStatus?: number;
  responseBody?: string;
  createdAt?: number;
}

export interface DlqSummary {
  dlqId: string;
  messageId: string;
  url: string;
  status?: number;
  error: string;
  createdAt?: number;
}

export async function listDeadLetters(count = 20): Promise<DlqSummary[]> {
  if (!hasQstash()) return [];
  try {
    const result = await getQstash().dlq.listMessages({ count });
    return ((result.messages ?? []) as unknown as DlqItem[]).map((item) => ({
      dlqId: item.dlqId,
      messageId: item.messageId ?? "unknown",
      url: item.url ?? "unknown",
      status: item.responseStatus,
      error: (item.responseBody ?? "").slice(0, 500),
      createdAt: item.createdAt,
    }));
  } catch (error) {
    console.warn("[dlq] Could not list dead letters:", error);
    return [];
  }
}

/**
 * Looks up one dead letter in this deployment's QStash account.
 *
 * QStash already scopes `dlq.retry`/`dlq.delete` to the account behind the
 * token, so this is defence in depth: it makes the ownership boundary explicit
 * instead of relying on the upstream API to reject foreign ids. The lookup uses
 * the `dlqIds` filter so it is exact and does not depend on how many dead
 * letters the account currently holds.
 */
export async function getDeadLetter(dlqId: string): Promise<DlqSummary | null> {
  if (!hasQstash()) return null;
  try {
    const result = await getQstash().dlq.listMessages({ dlqIds: [dlqId] });
    const item = ((result.messages ?? []) as unknown as DlqItem[]).find(
      (message) => message.dlqId === dlqId
    );
    if (!item) return null;
    return {
      dlqId: item.dlqId,
      messageId: item.messageId ?? "unknown",
      url: item.url ?? "unknown",
      status: item.responseStatus,
      error: (item.responseBody ?? "").slice(0, 500),
      createdAt: item.createdAt,
    };
  } catch (error) {
    console.warn("[dlq] Could not look up dead letter:", error);
    return null;
  }
}

/** Origins this deployment is allowed to have queued work for. */
function ownedOrigins(): string[] {
  const origins = new Set<string>();
  for (const value of [
    cleanEnv("APP_URL"),
    cleanEnv("NEXT_PUBLIC_SITE_URL"),
    getQstashWorkerUrl(),
  ]) {
    if (!value) continue;
    try {
      origins.add(new URL(value).origin);
    } catch {
      // Ignore malformed configuration rather than widening the allowlist.
    }
  }
  return [...origins];
}

/**
 * Returns the dead letter only when it belongs to this deployment.
 *
 * Throws `Unknown DLQ message` when the id is absent from the account's dead
 * letters, or when its target URL points at an origin we do not own. When no
 * origin is configured we skip the origin comparison but still require the id
 * to appear in the list.
 */
export async function assertDeadLetterOwned(dlqId: string): Promise<DlqSummary> {
  const message = await getDeadLetter(dlqId);
  if (!message) throw new Error("Unknown DLQ message");

  const origins = ownedOrigins();
  if (message.url && message.url !== "unknown" && origins.length > 0) {
    let origin: string | null = null;
    try {
      origin = new URL(message.url).origin;
    } catch {
      origin = null;
    }
    if (!origin || !origins.includes(origin)) {
      throw new Error("Unknown DLQ message");
    }
  }

  return message;
}

export async function replayDeadLetter(dlqId: string): Promise<void> {
  if (!hasQstash()) return;
  await assertDeadLetterOwned(dlqId);
  await getQstash().dlq.retry(dlqId);
}

export async function deleteDeadLetter(dlqId: string): Promise<void> {
  if (!hasQstash()) return;
  await assertDeadLetterOwned(dlqId);
  await getQstash().dlq.delete(dlqId);
}
