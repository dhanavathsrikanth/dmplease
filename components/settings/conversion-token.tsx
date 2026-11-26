"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ConversionToken({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="rounded-xl border border-[#e0e2e8] dark:border-border px-3 py-2.5 space-y-2">
      <p className="text-[11px] font-semibold text-foreground">
        Conversion tracking token
      </p>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Send a POST to <code className="font-mono">/api/conversions/&lt;token&gt;</code> from your checkout or pixel. Safe to embed in client-side code.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 truncate rounded-lg bg-[#f7f8fa] dark:bg-muted/40 px-2.5 py-1.5 text-[10px] font-mono">
          {token}
        </code>
        <Button variant="outline" size="icon" className="size-8 shrink-0" onClick={copy} aria-label="Copy conversion token">
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
    </div>
  );
}
