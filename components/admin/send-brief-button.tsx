"use client";

import { useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SendBriefButton() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/alerts/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forceBrief: true }),
      });
      const json = (await response.json()) as {
        success?: boolean;
        emailed?: number;
        created?: number;
        errors?: string[];
      };
      if (!response.ok || !json.success) {
        setMessage(json.errors?.join("; ") || "Could not send the brief.");
        return;
      }
      setMessage(
        json.emailed
          ? `Brief emailed to ${json.emailed} admin address(es).`
          : "Brief saved, but no email provider is configured."
      );
    } catch {
      setMessage("Network error while sending the brief.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button size="sm" onClick={() => void send()} disabled={busy} className="rounded-full text-xs h-9 px-5">
        {busy ? <Loader2 className="size-3.5 mr-1.5 animate-spin" aria-hidden="true" /> : <Mail className="size-3.5 mr-1.5" aria-hidden="true" />}
        Send architecture brief now
      </Button>
      {message && <p role="status" className="text-[11px] text-muted-foreground">{message}</p>}
    </div>
  );
}
