import { getQstash, hasQstash } from "@/lib/upstash";

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

export async function replayDeadLetter(dlqId: string): Promise<void> {
  if (!hasQstash()) return;
  await getQstash().dlq.retry(dlqId);
}

export async function deleteDeadLetter(dlqId: string): Promise<void> {
  if (!hasQstash()) return;
  await getQstash().dlq.delete(dlqId);
}
