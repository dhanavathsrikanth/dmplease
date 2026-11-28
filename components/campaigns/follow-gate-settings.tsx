"use client";

import React from "react";
import { UserCheck } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  FOLLOW_GATE_LIMITS,
  type FollowGateUnavailablePolicy,
} from "@/lib/follow-gate-constants";

export interface FollowGateSettingsProps {
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
  openingMessage: string;
  onOpeningMessageChange: (value: string) => void;
  buttonLabel: string;
  onButtonLabelChange: (value: string) => void;
  /** Kept for compatibility; the simplified gate always holds until verified. */
  onUnavailable?: FollowGateUnavailablePolicy;
  onUnavailableChange?: (value: FollowGateUnavailablePolicy) => void;
  /** "comment" enables the {keyword} token; "direct" is for DM/story/share rules. */
  mode?: "comment" | "direct";
  fieldErrors?: Record<string, string | string[] | undefined>;
  disabled?: boolean;
  className?: string;
}

function errorText(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
      {message}
    </p>
  );
}

/**
 * One canonical Ask-for-Follow editor used by the campaign builder and the
 * inbox/story/share rule manager. The simplified version keeps one decision —
 * on or off — and hides the message copy behind an optional disclosure.
 */
export function FollowGateSettings({
  enabled,
  onEnabledChange,
  openingMessage,
  onOpeningMessageChange,
  buttonLabel,
  onButtonLabelChange,
  mode = "comment",
  fieldErrors,
  disabled = false,
  className,
}: FollowGateSettingsProps) {
  const keywordToken = mode === "comment";
  const messageTooLong = openingMessage.length > FOLLOW_GATE_LIMITS.openingMessage;
  const labelTooLong = buttonLabel.length > FOLLOW_GATE_LIMITS.buttonLabel;

  return (
    <section
      aria-label="Ask for Follow settings"
      className={cn(
        "rounded-2xl border border-[#e0e2e8] dark:border-border/80 bg-background p-5 space-y-3.5 shadow-subtle",
        className
      )}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#fff8e0] text-[#8a6d1a] dark:bg-[#746019]/30 dark:text-[#ffd02f]">
            <UserCheck className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h4 className="font-semibold text-xs sm:text-sm text-foreground">
              Ask for Follow
            </h4>
            <p className="text-[11px] leading-relaxed text-[#555a6a] dark:text-muted-foreground mt-0.5">
              Send an opening DM first. We confirm the follow with Meta, then
              deliver the promise.
            </p>
          </div>
        </div>
        <Switch
          checked={enabled}
          disabled={disabled}
          onCheckedChange={onEnabledChange}
          aria-label="Ask people to follow before receiving the DM"
        />
      </div>

      {enabled && (
        <div className="space-y-3 border-t border-[#e0e2e8] dark:border-border/60 pt-3.5">
          <div className="rounded-xl bg-[#f7f8fa] dark:bg-muted/30 px-3.5 py-2.5 text-[11px] leading-relaxed text-[#555a6a] dark:text-muted-foreground">
            Follower comments → we send the opening DM → they tap the button →
            Meta confirms the follow → we deliver the promise.
          </div>

          <details className="rounded-xl border border-[#e0e2e8] p-3.5 dark:border-border">
            <summary className="cursor-pointer text-[11px] font-semibold text-foreground">
              Customize the opening message (optional)
            </summary>
            <div className="mt-3 space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="follow-opening-message" className="text-xs font-semibold">
                    Opening message
                  </Label>
                  <span
                    className={cn(
                      "font-mono text-[10px]",
                      messageTooLong
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-[#6b6f7e]"
                    )}
                  >
                    {openingMessage.length}/{FOLLOW_GATE_LIMITS.openingMessage}
                  </span>
                </div>
                <textarea
                  id="follow-opening-message"
                  rows={3}
                  value={openingMessage}
                  maxLength={FOLLOW_GATE_LIMITS.openingMessage}
                  disabled={disabled}
                  onChange={(event) => onOpeningMessageChange(event.target.value)}
                  aria-invalid={
                    messageTooLong || Boolean(errorText(fieldErrors?.openingMessage))
                  }
                  className="w-full resize-none rounded-xl border border-[#c7cad5] bg-background px-3.5 py-2.5 text-xs leading-relaxed outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:border-border"
                  placeholder="Hey {username}! Follow the account, then tap below to get your {keyword}."
                />
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] text-[#6b6f7e]">Insert:</span>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      onOpeningMessageChange(`${openingMessage} {username}`.trim())
                    }
                    className="rounded-full border border-[#e0e2e8] bg-[#f7f8fa] px-2.5 py-1 font-mono text-[10px] transition-colors hover:bg-[#eef0f3] disabled:opacity-50 dark:border-border/80 dark:bg-muted/30"
                  >
                    {"{username}"}
                  </button>
                  {keywordToken && (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() =>
                        onOpeningMessageChange(`${openingMessage} {keyword}`.trim())
                      }
                      className="rounded-full border border-[#e0e2e8] bg-[#f7f8fa] px-2.5 py-1 font-mono text-[10px] transition-colors hover:bg-[#eef0f3] disabled:opacity-50 dark:border-border/80 dark:bg-muted/30"
                    >
                      {"{keyword}"}
                    </button>
                  )}
                </div>
                <FieldError message={errorText(fieldErrors?.openingMessage)} />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="follow-button-label" className="text-xs font-semibold">
                    Button label
                  </Label>
                  <span
                    className={cn(
                      "font-mono text-[10px]",
                      labelTooLong ? "text-rose-600" : "text-[#6b6f7e]"
                    )}
                  >
                    {buttonLabel.length}/{FOLLOW_GATE_LIMITS.buttonLabel}
                  </span>
                </div>
                <Input
                  id="follow-button-label"
                  value={buttonLabel}
                  maxLength={FOLLOW_GATE_LIMITS.buttonLabel}
                  disabled={disabled}
                  onChange={(event) => onButtonLabelChange(event.target.value)}
                  placeholder="I'm following ✅"
                  className="h-9 rounded-lg text-xs"
                  aria-invalid={
                    labelTooLong ||
                    Boolean(errorText(fieldErrors?.followGateButtonLabel))
                  }
                />
                <FieldError message={errorText(fieldErrors?.followGateButtonLabel)} />
              </div>
            </div>
          </details>
        </div>
      )}
    </section>
  );
}
