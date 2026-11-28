"use client";

import { useId, useState } from "react";
import { Check, Link2, Plus, Trash2 } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  saveLinkRotator,
  type LinkRotatorView,
} from "@/app/dashboard/campaigns/link-actions";
import { shortLinkPreview } from "@/lib/link-preview";

interface LinkRotationSettingsProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  rotators: LinkRotatorView[];
  rotatorId: string | null;
  onRotatorIdChange: (id: string | null) => void;
  disabled?: boolean;
}

interface DraftTarget {
  destinationUrl: string;
  label: string;
}

export function LinkRotationSettings({
  enabled,
  onEnabledChange,
  rotators,
  rotatorId,
  onRotatorIdChange,
  disabled,
}: LinkRotationSettingsProps) {
  const baseId = useId();
  const selected = rotators.find((item) => item.id === rotatorId) ?? null;
  const [targets, setTargets] = useState<DraftTarget[]>(() =>
    selected && selected.targets.length > 0
      ? selected.targets.map((target) => ({
          destinationUrl: target.destinationUrl,
          label: target.label ?? "",
        }))
      : [{ destinationUrl: "", label: "" }]
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateTarget = (index: number, patch: Partial<DraftTarget>) => {
    setSaved(false);
    setTargets((current) =>
      current.map((target, i) => (i === index ? { ...target, ...patch } : target))
    );
  };

  const addTarget = () => {
    setSaved(false);
    setTargets((current) => [...current, { destinationUrl: "", label: "" }]);
  };

  const removeTarget = (index: number) => {
    setSaved(false);
    setTargets((current) => current.filter((_, i) => i !== index));
  };

  const save = async () => {
    const validTargets = targets.filter((target) => target.destinationUrl.trim());
    if (validTargets.length === 0) {
      setError("Add at least one destination link.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await saveLinkRotator({
        id: rotatorId ?? undefined,
        name: selected?.name ?? "Tracked links",
        mode: selected?.mode ?? "sticky",
        targets: validTargets.map((target) => ({
          destinationUrl: target.destinationUrl.trim(),
          label: target.label.trim(),
          enabled: true,
        })),
      });
      if (!result.success || !result.rotatorId) {
        setError(result.error ?? "Could not save your links.");
        return;
      }
      onRotatorIdChange(result.rotatorId);
      setSaved(true);
    } catch {
      setError("Network error while saving your links.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 p-5 shadow-subtle space-y-3.5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <h3 className="font-semibold text-xs sm:text-sm text-foreground flex items-center gap-1.5">
            <Link2 className="size-3.5 text-[#4262ff]" aria-hidden="true" />
            Smart tracked links
          </h3>
          <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground max-w-lg">
            We shorten your link and track every click. Add one or more destinations —
            we&apos;ll split followers across them automatically.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Label htmlFor={`${baseId}-toggle`} className="text-[11px] text-muted-foreground">
            {enabled ? "On" : "Off"}
          </Label>
          <Switch
            id={`${baseId}-toggle`}
            checked={enabled}
            onCheckedChange={onEnabledChange}
            disabled={disabled}
          />
        </div>
      </div>

      {enabled && (
        <div className="space-y-3 border-t border-[#e0e2e8] dark:border-border/60 pt-3.5">
          <div className="rounded-xl bg-[#f5f3ff] dark:bg-[#4262ff]/10 px-3 py-2.5 text-[11px] leading-relaxed text-[#555a6a] dark:text-muted-foreground">
            Your followers see{" "}
            <code className="font-mono font-semibold text-foreground">
              {shortLinkPreview()}
            </code>{" "}
            — a short, clickable link. Clicks are tracked automatically.
          </div>

          <div className="space-y-2">
            <p className="text-[11px] font-medium text-foreground">
              Where should the link go?
            </p>
            {targets.map((target, index) => (
              <div
                key={index}
                className="space-y-2 rounded-xl border border-[#e0e2e8] p-2.5 dark:border-border"
              >
                <div className="flex items-center gap-2">
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[#4262ff]/10 text-[10px] font-bold text-[#4262ff]">
                    {index + 1}
                  </span>
                  <Input
                    aria-label={`Destination ${index + 1} URL`}
                    placeholder="https://yourbrand.com/offer"
                    value={target.destinationUrl}
                    onChange={(event) =>
                      updateTarget(index, { destinationUrl: event.target.value })
                    }
                    disabled={busy}
                    className="h-9 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => removeTarget(index)}
                    disabled={busy || targets.length === 1}
                    aria-label={`Remove destination ${index + 1}`}
                    className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-40"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </button>
                </div>
                <Input
                  aria-label={`Destination ${index + 1} label`}
                  placeholder="Label (optional) — e.g. Instagram offer"
                  value={target.label}
                  onChange={(event) => updateTarget(index, { label: event.target.value })}
                  disabled={busy}
                  className="h-8 text-xs"
                />
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || targets.length >= 10}
              onClick={addTarget}
              className="rounded-full text-[11px] h-8 px-3"
            >
              <Plus className="size-3.5 mr-1.5" aria-hidden="true" />
              Add destination
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
              <Check className="size-3" aria-hidden="true" />
              Followers are split across your destinations. Each person always gets the
              same one, so you can see which offer converts.
            </p>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => void save()}
              className="text-[11px] h-8"
            >
              {busy ? "Saving…" : saved ? "Saved" : "Save links"}
            </Button>
          </div>

          {error && (
            <p role="alert" className="text-[11px] font-medium text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
