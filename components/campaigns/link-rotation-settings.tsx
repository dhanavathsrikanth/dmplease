"use client";

import { useId, useState } from "react";
import { Check, Link2, Plus, Trash2 } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  deleteLinkRotator,
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
  enabled: boolean;
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
  const [items, setItems] = useState<LinkRotatorView[]>(rotators);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"sticky" | "round_robin">("sticky");
  const [targets, setTargets] = useState<DraftTarget[]>([
    { destinationUrl: "", label: "", enabled: true },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateTarget = (index: number, patch: Partial<DraftTarget>) => {
    setTargets((current) =>
      current.map((target, i) => (i === index ? { ...target, ...patch } : target))
    );
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await saveLinkRotator({
        name,
        mode,
        targets: targets.map((target) => ({
          destinationUrl: target.destinationUrl,
          label: target.label,
          enabled: target.enabled,
        })),
      });
      if (!result.success || !result.rotatorId) {
        setError(result.error ?? "Could not save the link group.");
        return;
      }
      setItems((current) => [
        {
          id: result.rotatorId!,
          name,
          mode,
          targets: targets.map((target, index) => ({
            id: `draft-${index}`,
            destinationUrl: target.destinationUrl,
            label: target.label || null,
            enabled: target.enabled,
          })),
        },
        ...current,
      ]);
      onRotatorIdChange(result.rotatorId);
      setEditing(false);
      setName("");
      setTargets([{ destinationUrl: "", label: "", enabled: true }]);
    } catch {
      setError("Network error while saving the link group.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await deleteLinkRotator(id);
      if (!result.success) {
        setError(result.error ?? "Could not delete the link group.");
        return;
      }
      setItems((current) => current.filter((item) => item.id !== id));
      if (rotatorId === id) onRotatorIdChange(null);
    } catch {
      setError("Network error while deleting the link group.");
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
            Send a short, clickable link instead of a long URL. Every click is tracked, and
            you can split followers across several destinations.
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
            Your followers will see{" "}
            <code className="font-mono font-semibold text-foreground">
              {shortLinkPreview()}
            </code>{" "}
            — short enough for Instagram to make it clickable, with attribution recorded
            automatically.
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${baseId}-rotator`} className="text-[11px]">
              Destination group
            </Label>
            <select
              id={`${baseId}-rotator`}
              value={rotatorId ?? ""}
              onChange={(event) => onRotatorIdChange(event.target.value || null)}
              disabled={disabled || busy}
              className="h-9 w-full rounded-lg border border-[#c7cad5] dark:border-border bg-background px-3 text-xs outline-none focus:border-[#4262ff] focus:ring-2 focus:ring-[#4262ff]/20"
            >
              <option value="">Single destination (no rotation)</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.targets.filter((t) => t.enabled).length} destinations
                </option>
              ))}
            </select>
            {rotatorId && (
              <p className="text-[10px] text-muted-foreground">
                {items.find((item) => item.id === rotatorId)?.mode === "round_robin"
                  ? "Rotating evenly: each new follower gets the next destination in order."
                  : "Sticky per person: each follower always gets the same destination, so attribution stays clean."}
              </p>
            )}
          </div>

          {rotatorId && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || busy}
              onClick={() => void remove(rotatorId)}
              className="text-[11px] text-destructive hover:text-destructive"
            >
              <Trash2 className="size-3 mr-1.5" aria-hidden="true" />
              Delete this group
            </Button>
          )}

          {!editing ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => setEditing(true)}
              className="rounded-full text-[11px] h-8 px-3"
            >
              <Plus className="size-3.5 mr-1.5" aria-hidden="true" />
              {items.length ? "Create another group" : "Create a rotation group"}
            </Button>
          ) : (
            <div className="rounded-xl border border-[#e0e2e8] dark:border-border p-3 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor={`${baseId}-name`} className="text-[11px]">
                  Group name
                </Label>
                <Input
                  id={`${baseId}-name`}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Offer split test"
                  maxLength={80}
                  disabled={busy}
                  className="h-8 text-xs"
                />
              </div>

              <fieldset className="space-y-1.5">
                <legend className="text-[11px] font-medium">Rotation style</legend>
                <div className="flex flex-wrap gap-3">
                  {(["sticky", "round_robin"] as const).map((value) => (
                    <label key={value} className="flex items-center gap-1.5 text-[11px]">
                      <input
                        type="radio"
                        name={`${baseId}-mode`}
                        checked={mode === value}
                        onChange={() => setMode(value)}
                        disabled={busy}
                        className="accent-[#4262ff]"
                      />
                      {value === "sticky" ? "Same link per person" : "Rotate evenly"}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="space-y-2">
                <p className="text-[11px] font-medium">Destinations</p>
                {targets.map((target, index) => (
                  <div key={index} className="grid grid-cols-[1fr,120px,auto] gap-2 items-center">
                    <Input
                      aria-label={`Destination ${index + 1} URL`}
                      placeholder="https://yourbrand.com/offer"
                      value={target.destinationUrl}
                      onChange={(event) => updateTarget(index, { destinationUrl: event.target.value })}
                      disabled={busy}
                      className="h-8 text-xs"
                    />
                    <Input
                      aria-label={`Destination ${index + 1} label`}
                      placeholder="Label"
                      value={target.label}
                      onChange={(event) => updateTarget(index, { label: event.target.value })}
                      disabled={busy}
                      className="h-8 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setTargets((current) => current.filter((_, i) => i !== index))
                      }
                      disabled={busy || targets.length === 1}
                      aria-label={`Remove destination ${index + 1}`}
                      className="text-muted-foreground hover:text-destructive disabled:opacity-40"
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || targets.length >= 10}
                  onClick={() =>
                    setTargets((current) => [
                      ...current,
                      { destinationUrl: "", label: "", enabled: true },
                    ])
                  }
                  className="rounded-full text-[10px] h-7 px-3"
                >
                  <Plus className="size-3 mr-1" aria-hidden="true" />
                  Add destination
                </Button>
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setEditing(false)}
                  className="text-[11px]"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() => void save()}
                  className="text-[11px] h-8"
                >
                  {busy ? "Saving…" : "Save group"}
                </Button>
              </div>
            </div>
          )}

          {error && (
            <p role="alert" className="text-[11px] font-medium text-destructive">
              {error}
            </p>
          )}
          <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
            <Check className="size-3" aria-hidden="true" />
            Clicks are recorded per destination, so you can see which offer actually converts.
          </p>
        </div>
      )}
    </Card>
  );
}
