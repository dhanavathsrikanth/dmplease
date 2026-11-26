"use client";

import { useState } from "react";
import { BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface VerifiedBadgeToggleProps {
  initialChecked: boolean;
  detectedByMeta: boolean;
}

export function VerifiedBadgeToggle({
  initialChecked,
  detectedByMeta,
}: VerifiedBadgeToggleProps) {
  const [checked, setChecked] = useState(initialChecked);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    const next = !checked;
    setChecked(next);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/instagram/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isVerifiedManual: next }),
      });
      if (!response.ok) throw new Error("Could not save this setting");
    } catch (err) {
      setChecked(!next);
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[#e0e2e8] dark:border-border px-3 py-2.5">
      <div className="flex items-center gap-2 text-[11px]">
        <BadgeCheck
          className={cn(
            "size-4",
            checked ? "text-sky-500 fill-sky-500 text-white" : "text-muted-foreground"
          )}
        />
        <div>
          <p className="font-semibold text-foreground">Verified badge</p>
          <p className="text-muted-foreground">
            {detectedByMeta
              ? "Detected from the linked Facebook Page"
              : "Meta does not expose this signal for this connection — set it manually"}
          </p>
          {error && <p className="mt-0.5 text-rose-600">{error}</p>}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label="Verified badge"
        disabled={busy}
        onClick={toggle}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50",
          checked ? "bg-[#4262ff]" : "bg-neutral-300 dark:bg-neutral-700"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-0.5"
          )}
        />
      </button>
    </div>
  );
}
