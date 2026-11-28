"use client";

import { useState } from "react";
import posthog from "posthog-js";
import { AlertCircle, Check, Loader2, MessageSquareDashed } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { FollowGateSettings } from "@/components/campaigns/follow-gate-settings";
import { DmVariablePicker } from "@/components/campaigns/dm-variable-picker";
import {
  FOLLOW_GATE_DEFAULTS,
  type FollowGateUnavailablePolicy,
} from "@/lib/follow-gate-constants";
import type { FallbackReplyConfig } from "@/lib/dm-rules";
import { saveFallbackReply } from "@/app/dashboard/settings/actions";

export interface FallbackAccountOption {
  id: string;
  username: string;
  workspaceId: string;
  fallback: FallbackReplyConfig;
}

interface FormState {
  enabled: boolean;
  message: string;
  variants: string;
  oncePerDays: number;
  buttonText: string;
  buttonUrl: string;
  followGateEnabled: boolean;
  openingMessage: string;
  buttonLabel: string;
  onUnavailable: FollowGateUnavailablePolicy;
}

function toForm(fallback?: Partial<FallbackReplyConfig>): FormState {
  return {
    enabled: Boolean(fallback?.enabled),
    message: fallback?.message ?? "",
    variants: (fallback?.variants ?? []).join("\n"),
    oncePerDays: fallback?.oncePerDays ?? 45,
    buttonText: fallback?.buttonText || "",
    buttonUrl: fallback?.buttonUrl || "",
    followGateEnabled: Boolean(fallback?.followGateEnabled),
    openingMessage: fallback?.openingMessage || FOLLOW_GATE_DEFAULTS.openingMessage,
    buttonLabel: fallback?.buttonLabel || FOLLOW_GATE_DEFAULTS.buttonLabel,
    onUnavailable: fallback?.onUnavailable ?? "hold",
  };
}

/** Account-level "Respond to all DMs" — only reached when no rule matched. */
export function FallbackReplySettings({
  accounts,
}: {
  accounts: FallbackAccountOption[];
}) {
  const [selectedId, setSelectedId] = useState(accounts[0]?.id || "");
  const [form, setForm] = useState<FormState>(() =>
    toForm(accounts[0]?.fallback)
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const selected = accounts.find((account) => account.id === selectedId);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await saveFallbackReply({
        workspaceId: selected.workspaceId,
        accountId: selected.id,
        enabled: form.enabled,
        message: form.message,
        variants: form.variants
          .split("\n")
          .map((value) => value.trim())
          .filter(Boolean),
        oncePerDays: form.oncePerDays,
        followGateEnabled: form.followGateEnabled,
        openingMessage: form.followGateEnabled ? form.openingMessage : "",
        buttonLabel: form.followGateEnabled ? form.buttonLabel : "",
        onUnavailable: form.onUnavailable,
        buttonText: form.buttonText,
        buttonUrl: form.buttonUrl,
      });
      if (!result.success) {
        setError(result.error || "Could not save the fallback.");
        return;
      }
      posthog.capture("fallback_reply_saved", {
        enabled: form.enabled,
        variants: form.variants.split("\n").filter(Boolean).length,
      });
      setNotice("Respond to all DMs settings saved.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (accounts.length === 0) {
    return (
      <Card className="rounded-2xl border border-dashed border-[#e0e2e8] dark:border-border/80 p-5 text-xs text-[#555a6a] dark:text-muted-foreground">
        Connect an Instagram account to configure a fallback reply.
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle bg-card p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <MessageSquareDashed className="size-4 text-[#4262ff]" aria-hidden="true" />
            Respond to all DMs
          </h2>
          <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground mt-1 max-w-xl">
            A catch-all reply for messages that match none of your keyword rules.
            Specific and catch-all rules always run first — this is the final safety net,
            throttled to once per person and fully opt-out capable.
          </p>
        </div>
        <Badge variant="outline" className="text-[10px] rounded-full w-fit">
          Final fallback
        </Badge>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="fallback-account">Instagram account</Label>
          <select
            id="fallback-account"
            value={selectedId}
            disabled={busy}
            onChange={(event) => {
              const next = accounts.find((item) => item.id === event.target.value);
              setSelectedId(event.target.value);
              if (next) setForm(toForm(next.fallback));
              setError(null);
              setNotice(null);
            }}
            className="flex h-9 w-full rounded-full border border-[#c7cad5] dark:border-border bg-background px-3.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                @{account.username}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-between rounded-2xl border border-[#e0e2e8] dark:border-border/60 bg-[#f7f8fa] dark:bg-muted/40 px-4 py-2.5">
          <div>
            <Label htmlFor="fallback-enabled" className="cursor-pointer text-xs">
              Enable fallback
            </Label>
            <p className="text-[10px] text-[#6b6f7e] mt-0.5">
              Off by default — nothing changes until you turn it on.
            </p>
          </div>
          <Switch
            id="fallback-enabled"
            checked={form.enabled}
            disabled={busy}
            onCheckedChange={(value) => update("enabled", value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="fallback-message">Reply message</Label>
        <DmVariablePicker
          textareaId="fallback-message"
          value={form.message}
          onChange={(value) => update("message", value)}
          disabled={busy}
        />
        <textarea
          id="fallback-message"
          rows={3}
          value={form.message}
          disabled={busy}
          onChange={(event) => update("message", event.target.value)}
          placeholder="Thanks for messaging! Here's a link to everything we offer: {link}"
          className="w-full rounded-xl border border-[#c7cad5] dark:border-border bg-background px-3.5 py-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 resize-none"
        />
        <p className="text-[10px] text-[#6b6f7e]">
          Supports {"{username}"}, {"{name}"}, {"{email}"}, {"{phone}"}, {"{keyword}"}, {"{link}"}, {"{voucher}"} and {"{voucher_url}"}.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="fallback-variants">Variants (one per line)</Label>
          <textarea
            id="fallback-variants"
            rows={3}
            value={form.variants}
            disabled={busy}
            onChange={(event) => update("variants", event.target.value)}
            placeholder={"Hey {username}, here's what you need: {link}\nWelcome! Grab it here: {link}"}
            className="w-full rounded-xl border border-[#c7cad5] dark:border-border bg-background px-3.5 py-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 resize-none"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fallback-once">Run at most once per (days)</Label>
          <Input
            id="fallback-once"
            type="number"
            min={0}
            max={365}
            value={form.oncePerDays}
            disabled={busy}
            onChange={(event) => update("oncePerDays", Number(event.target.value))}
            className="h-9 rounded-full text-xs"
          />
          <p className="text-[10px] text-[#6b6f7e]">
            Prevents spamming the same person on every message.
          </p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="fallback-button-text">Button label (optional)</Label>
          <Input
            id="fallback-button-text"
            value={form.buttonText}
            disabled={busy}
            onChange={(event) => update("buttonText", event.target.value)}
            placeholder="See everything"
            className="h-9 rounded-full text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fallback-button-url">Button URL (optional)</Label>
          <Input
            id="fallback-button-url"
            value={form.buttonUrl}
            disabled={busy}
            onChange={(event) => update("buttonUrl", event.target.value)}
            placeholder="https://example.com/start-here"
            className="h-9 rounded-full text-xs"
          />
        </div>
      </div>

      <FollowGateSettings
        mode="direct"
        enabled={form.followGateEnabled}
        onEnabledChange={(value) => update("followGateEnabled", value)}
        openingMessage={form.openingMessage}
        onOpeningMessageChange={(value) => update("openingMessage", value)}
        buttonLabel={form.buttonLabel}
        onButtonLabelChange={(value) => update("buttonLabel", value)}
        onUnavailable={form.onUnavailable}
        onUnavailableChange={(value) => update("onUnavailable", value)}
        disabled={busy}
      />

      {(error || notice) && (
        <div
          role="status"
          className={`flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs ${
            error
              ? "border border-destructive/30 bg-destructive/10 text-destructive"
              : "border border-emerald-300/60 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          }`}
        >
          {error ? (
            <AlertCircle className="size-4 shrink-0" />
          ) : (
            <Check className="size-4 shrink-0" />
          )}
          {error || notice}
        </div>
      )}

      <Button
        onClick={handleSave}
        disabled={busy}
        className="rounded-full text-xs font-semibold h-9 bg-[#1c1c1e] text-white dark:bg-[#ffd02f] dark:text-[#1c1c1e]"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
        Save fallback
      </Button>
    </Card>
  );
}
