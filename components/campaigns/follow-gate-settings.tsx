"use client";

import React from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Info,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  onUnavailable: FollowGateUnavailablePolicy;
  onUnavailableChange: (value: FollowGateUnavailablePolicy) => void;
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

const POLICY_OPTIONS: Array<{
  value: FollowGateUnavailablePolicy;
  title: string;
  description: string;
}> = [
  {
    value: "hold",
    title: "Hold delivery",
    description:
      "Keep the lead and ask them to tap again. Nothing is sent until Meta confirms the follow.",
  },
  {
    value: "deliver",
    title: "Deliver anyway",
    description:
      "Send the content and log an exception. Use only when losing a lead is worse than an unverified gate.",
  },
];

/**
 * One canonical Ask-for-Follow editor used by the campaign builder and the
 * inbox/story/share rule manager. Keeping a single component makes the
 * behaviour, copy and validation identical everywhere the gate is available.
 */
export function FollowGateSettings({
  enabled,
  onEnabledChange,
  openingMessage,
  onOpeningMessageChange,
  buttonLabel,
  onButtonLabelChange,
  onUnavailable,
  onUnavailableChange,
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
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-[#fff8e0] text-[#8a6d1a] dark:bg-[#746019]/30 dark:text-[#ffd02f]">
            <UserCheck className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-semibold text-xs sm:text-sm text-foreground">
                Ask for Follow
              </h4>
              <Badge
                variant="outline"
                className="text-[10px] font-medium rounded-full px-2.5 py-0.5"
              >
                Verification by Meta
              </Badge>
            </div>
            <p
              id="follow-gate-description"
              className="text-[11px] leading-relaxed text-[#555a6a] dark:text-muted-foreground mt-1"
            >
              Send an opening DM first. After the person taps the button, we confirm
              they follow you with Meta before releasing the promised content.
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <Switch
            checked={enabled}
            disabled={disabled}
            onCheckedChange={onEnabledChange}
            aria-label="Ask people to follow before receiving the DM"
            aria-describedby="follow-gate-description"
          />
          <span className="text-[10px] font-medium text-[#6b6f7e]">
            {enabled ? "On" : "Off"}
          </span>
        </div>
      </div>

      {!enabled ? (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-[#e0e2e8] dark:border-border/70 bg-[#f7f8fa] dark:bg-muted/30 px-3.5 py-2.5 text-[11px] text-[#555a6a] dark:text-muted-foreground">
          <Info className="size-3.5 shrink-0" aria-hidden="true" />
          The DM is delivered as soon as the trigger fires. Turn the gate on to
          grow followers from every reply.
        </div>
      ) : (
        <div className="space-y-4 border-t border-[#e0e2e8] dark:border-border/60 pt-4">
          {/* Flow explainer — makes the opt-in behaviour predictable. */}
          <ol className="grid gap-2 sm:grid-cols-3" aria-label="How the follow gate works">
            {[
              { title: "1 · Trigger", detail: "Comment or keyword arrives" },
              { title: "2 · Opening DM", detail: "Follower taps the button" },
              { title: "3 · Verified", detail: "We confirm, then deliver" },
            ].map((step, index) => (
              <li
                key={step.title}
                className="rounded-xl border border-[#e0e2e8] dark:border-border/60 bg-[#f7f8fa] dark:bg-muted/30 px-3 py-2"
              >
                <p className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
                  {step.title}
                  {index < 2 && (
                    <ArrowRight className="size-3 text-[#8e93a3] hidden sm:block" aria-hidden="true" />
                  )}
                </p>
                <p className="text-[10px] text-[#6b6f7e] dark:text-muted-foreground mt-0.5">
                  {step.detail}
                </p>
              </li>
            ))}
          </ol>

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
              aria-invalid={messageTooLong || Boolean(errorText(fieldErrors?.openingMessage))}
              className="w-full rounded-xl border border-[#c7cad5] dark:border-border bg-background px-3.5 py-2.5 text-xs leading-relaxed outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 resize-none"
              placeholder="Hey {username}! Follow the account, then tap below to get your {keyword}."
            />
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] text-[#6b6f7e]">Insert:</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  onOpeningMessageChange(`${openingMessage} {username}`.trim())
                }
                className="rounded-full border border-[#e0e2e8] dark:border-border/80 bg-[#f7f8fa] dark:bg-muted/30 px-2.5 py-1 font-mono text-[10px] transition-colors hover:bg-[#eef0f3] disabled:opacity-50"
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
                  className="rounded-full border border-[#e0e2e8] dark:border-border/80 bg-[#f7f8fa] dark:bg-muted/30 px-2.5 py-1 font-mono text-[10px] transition-colors hover:bg-[#eef0f3] disabled:opacity-50"
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
              aria-invalid={labelTooLong || Boolean(errorText(fieldErrors?.followGateButtonLabel))}
            />
            <p className="text-[10px] text-[#6b6f7e]">
              Meta allows up to {FOLLOW_GATE_LIMITS.buttonLabel} characters on a button.
            </p>
            <FieldError message={errorText(fieldErrors?.followGateButtonLabel)} />
          </div>

          <fieldset disabled={disabled} className="space-y-2">
            <legend className="text-xs font-semibold text-foreground">
              If Meta can&apos;t confirm the follow
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {POLICY_OPTIONS.map((option) => {
                const selected = onUnavailable === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onUnavailableChange(option.value)}
                    className={cn(
                      "rounded-xl border px-3.5 py-3 text-left transition-colors",
                      selected
                        ? "border-[#4262ff] bg-[#4262ff]/5 ring-2 ring-[#4262ff]/15"
                        : "border-[#e0e2e8] dark:border-border/70 bg-[#f7f8fa] dark:bg-muted/30 hover:border-[#c7cad5]"
                    )}
                  >
                    <span className="flex items-center gap-2 text-[11px] font-semibold text-foreground">
                      <span
                        className={cn(
                          "grid size-4 place-items-center rounded-full border",
                          selected
                            ? "border-[#4262ff] bg-[#4262ff] text-white"
                            : "border-[#c7cad5]"
                        )}
                      >
                        {selected && <Check className="size-2.5" aria-hidden="true" />}
                      </span>
                      {option.title}
                    </span>
                    <span className="block text-[10px] leading-relaxed text-[#555a6a] dark:text-muted-foreground mt-1.5">
                      {option.description}
                    </span>
                  </button>
                );
              })}
            </div>
            <FieldError message={errorText(fieldErrors?.followGateOnUnavailable)} />
          </fieldset>

          <div className="flex gap-2.5 rounded-xl border border-[#e0e2e8] dark:border-border/60 bg-[#f7f8fa] dark:bg-muted/30 px-3.5 py-3">
            <ShieldCheck className="size-4 shrink-0 text-[#4262ff] mt-0.5" aria-hidden="true" />
            <p className="text-[10px] leading-relaxed text-[#555a6a] dark:text-muted-foreground">
              <strong className="font-semibold text-foreground">Why an opening DM?</strong>{" "}
              Meta only exposes follow status after someone messages you or taps a
              button. The tap grants that consent and opens the 24-hour messaging
              window, so the verified DM arrives instantly.
            </p>
          </div>

          <div className="flex gap-2.5 rounded-xl border border-amber-200/70 dark:border-amber-500/20 bg-amber-50/70 dark:bg-amber-500/10 px-3.5 py-3">
            <AlertTriangle
              className="size-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5"
              aria-hidden="true"
            />
            <p className="text-[10px] leading-relaxed text-amber-900/80 dark:text-amber-200/80">
              Use the gate for freebies and content people ask for. Don&apos;t gate
              purchases, bookings or support replies — Meta&apos;s spam policies treat
              engagement-for-content prompts as sensitive.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
