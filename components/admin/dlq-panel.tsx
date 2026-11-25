"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DlqItem {
  dlqId: string;
  messageId: string;
  url: string;
  status?: number;
  error: string;
  createdAt?: number;
}

export function DlqPanel() {
  const [items, setItems] = useState<DlqItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/dlq");
      const json = (await response.json()) as { messages?: DlqItem[]; error?: string };
      if (!response.ok) {
        setMessage(json.error ?? "Could not load the dead-letter queue.");
        return;
      }
      setItems(json.messages ?? []);
    } catch {
      setMessage("Network error while loading the dead-letter queue.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: "replay" | "delete", dlqId: string) {
    setBusy(dlqId);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/dlq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, dlqId }),
      });
      const json = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage(json.error ?? `Could not ${action} message.`);
        return;
      }
      setMessage(action === "replay" ? "Message replayed." : "Message deleted.");
      await load();
    } catch {
      setMessage("Network error during DLQ action.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-sm">Dead-letter queue</h2>
          <p className="text-[11px] text-muted-foreground">
            Failed webhook jobs. Replay after fixing the underlying issue, or delete hopeless messages.
          </p>
        </div>
        <Button size="sm" variant="outline" className="rounded-full text-xs h-8 px-3" onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
      </div>

      {message && <p role="status" className="text-[11px] text-muted-foreground">{message}</p>}

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">No dead-letter messages. Healthy.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.dlqId} className="rounded-xl border border-[#e0e2e8] dark:border-border p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono text-[11px] text-foreground truncate">{item.messageId}</p>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 rounded-full px-2.5 text-[10px]"
                    disabled={busy === item.dlqId}
                    onClick={() => void act("replay", item.dlqId)}
                  >
                    <RotateCcw className="size-3 mr-1" aria-hidden="true" /> Replay
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 rounded-full px-2.5 text-[10px] text-destructive"
                    disabled={busy === item.dlqId}
                    onClick={() => void act("delete", item.dlqId)}
                  >
                    <Trash2 className="size-3 mr-1" aria-hidden="true" /> Delete
                  </Button>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground truncate">{item.url}</p>
              {item.error && <p className="text-[10px] font-mono text-muted-foreground line-clamp-2">{item.error}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
