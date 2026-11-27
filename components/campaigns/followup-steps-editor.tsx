"use client";

import { useId, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  FOLLOWUP_DEFAULTS,
  FOLLOWUP_LIMITS,
  formatDelay,
} from "@/lib/followup-constants";
import { saveFollowupSteps } from "@/app/dashboard/campaigns/actions";
import type { FollowupStepInput } from "@/lib/validation/followup";

export interface FollowupStepView {
  step: number;
  delayMinutes: number;
  message: string;
  enabled: boolean;
  holdoutPercent: number;
}

type Unit = "minutes" | "hours" | "days";
const UNIT_DIVISOR: Record<Unit, number> = {
  minutes: 1,
  hours: 60,
  days: 1440,
};

function unitFor(minutes: number): Unit {
  if (minutes % UNIT_DIVISOR.days === 0) return "days";
  if (minutes % UNIT_DIVISOR.hours === 0) return "hours";
  return "minutes";
}

function clampDelay(value: number): number {
  return Math.min(
    FOLLOWUP_LIMITS.maxDelayMinutes,
    Math.max(FOLLOWUP_LIMITS.minDelayMinutes, Math.round(value))
  );
}

function newStep(step: number): FollowupStepInput {
  return {
    step,
    delayMinutes: FOLLOWUP_DEFAULTS.delayMinutes * step,
    message: FOLLOWUP_DEFAULTS.message,
    enabled: true,
    holdoutPercent: FOLLOWUP_DEFAULTS.holdoutPercent,
  };
}

interface FollowupStepsEditorProps {
  campaignId: string;
  initialSteps: FollowupStepView[];
}

export function FollowupStepsEditor({
  campaignId,
  initialSteps,
}: FollowupStepsEditorProps) {
  const baseId = useId();
  const [steps, setSteps] = useState<FollowupStepInput[]>(
    initialSteps.map((step) => ({ ...step }))
  );
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const update = (index: number, patch: Partial<FollowupStepInput>) => {
    setSteps((current) =>
      current.map((step, i) => (i === index ? { ...step, ...patch } : step))
    );
  };

  const addStep = () => {
    const used = new Set(steps.map((step) => step.step));
    let next = 1;
    while (used.has(next)) next++;
    setSteps((current) => [...current, newStep(next)]);
    setStatus(null);
    setError(null);
  };

  const removeStep = (index: number) => {
    setSteps((current) => current.filter((_, i) => i !== index));
    setStatus(null);
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setStatus(null);
    setFieldErrors({});
    try {
      const result = await saveFollowupSteps(campaignId, steps);
      if (result.success) {
        setStatus("Follow-ups saved. They send automatically when due.");
      } else {
        setError(result.error ?? "Could not save follow-ups");
        setFieldErrors(
          (result as { fieldErrors?: Record<string, string[]> }).fieldErrors ?? {}
        );
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section id="followups" aria-labelledby={`${baseId}-heading`}>
      <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 p-5 shadow-subtle space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2
              id={`${baseId}-heading`}
              className="font-semibold text-sm text-foreground"
            >
              24h follow-ups
            </h2>
            <p className="text-xs text-[#555a6a] dark:text-muted-foreground mt-0.5 max-w-xl">
              Send a gentle reminder after someone opts in (or after their first DM
              if Ask for Follow is off). The sequence stops automatically when they
              click a link, reply, convert, or enter the holdout group.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addStep}
            disabled={steps.length >= FOLLOWUP_LIMITS.maxSteps || saving}
            className="rounded-full text-xs h-9 px-4"
          >
            <Plus className="size-3.5 mr-1.5" aria-hidden="true" />
            Add follow-up
          </Button>
        </div>

        {steps.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[#e0e2e8] dark:border-border px-4 py-6 text-center text-xs text-muted-foreground">
            No follow-ups yet. Add one to send a reminder after the first DM.
          </p>
        ) : (
          <ol className="space-y-4">
            {steps.map((step, index) => {
              const unit = unitFor(step.delayMinutes);
              const amount = Math.round(step.delayMinutes / UNIT_DIVISOR[unit]);
              const messageId = `${baseId}-message-${index}`;
              const messageHelpId = `${baseId}-message-help-${index}`;
              const delayId = `${baseId}-delay-${index}`;
              const unitId = `${baseId}-unit-${index}`;
              const holdoutId = `${baseId}-holdout-${index}`;
              const stepErrors = {
                delay: fieldErrors[`${index}.delayMinutes`],
                message: fieldErrors[`${index}.message`],
                holdout: fieldErrors[`${index}.holdoutPercent`],
              };
              return (
                <li key={`${step.step}-${index}`}>
                  <fieldset className="rounded-xl border border-[#e0e2e8] dark:border-border px-4 py-4 space-y-3.5">
                    <legend className="sr-only">Follow-up {step.step}</legend>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold">
                        Follow-up #{step.step}
                        <span className="ml-2 font-normal text-muted-foreground">
                          {formatDelay(step.delayMinutes)} after opt-in
                        </span>
                      </p>
                      <div className="flex items-center gap-2">
                        <Label
                          htmlFor={`${baseId}-enabled-${index}`}
                          className="text-[11px] text-muted-foreground"
                        >
                          Enabled
                        </Label>
                        <Switch
                          id={`${baseId}-enabled-${index}`}
                          checked={step.enabled}
                          onCheckedChange={(checked) => update(index, { enabled: checked })}
                          aria-label={`Enable follow-up ${step.step}`}
                          disabled={saving}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground hover:text-destructive"
                          onClick={() => removeStep(index)}
                          disabled={saving}
                          aria-label={`Remove follow-up ${step.step}`}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-end gap-3">
                      <div className="space-y-1">
                        <Label htmlFor={delayId} className="text-[11px]">
                          Wait
                        </Label>
                        <Input
                          id={delayId}
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={FOLLOWUP_LIMITS.maxDelayMinutes / UNIT_DIVISOR[unit]}
                          value={amount}
                          onChange={(event) =>
                            update(index, {
                              delayMinutes: clampDelay(
                                Number(event.target.value) * UNIT_DIVISOR[unit]
                              ),
                            })
                          }
                          className="h-9 w-24 text-xs rounded-lg"
                          aria-invalid={Boolean(stepErrors.delay)}
                          aria-describedby={stepErrors.delay ? `${delayId}-error` : undefined}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={unitId} className="text-[11px]">
                          Unit
                        </Label>
                        <select
                          id={unitId}
                          value={unit}
                          onChange={(event) => {
                            const nextUnit = event.target.value as Unit;
                            update(index, {
                              delayMinutes: clampDelay(
                                amount * UNIT_DIVISOR[nextUnit]
                              ),
                            });
                          }}
                          className="h-9 rounded-lg border border-[#c7cad5] dark:border-border bg-background px-3 text-xs"
                        >
                          <option value="minutes">minutes</option>
                          <option value="hours">hours</option>
                          <option value="days">days</option>
                        </select>
                      </div>
                      <div className="space-y-1 flex-1 min-w-[180px]">
                        <Label htmlFor={holdoutId} className="text-[11px]">
                          Holdout {step.holdoutPercent}%
                        </Label>
                        <input
                          id={holdoutId}
                          type="range"
                          min={FOLLOWUP_LIMITS.minHoldoutPercent}
                          max={FOLLOWUP_LIMITS.maxHoldoutPercent}
                          step={5}
                          value={step.holdoutPercent}
                          onChange={(event) =>
                            update(index, { holdoutPercent: Number(event.target.value) })
                          }
                          className="w-full accent-[#4262ff]"
                          aria-describedby={`${holdoutId}-help`}
                        />
                        <p id={`${holdoutId}-help`} className="text-[10px] text-muted-foreground">
                          {step.holdoutPercent === 0
                            ? "Everyone receives this follow-up."
                            : `${step.holdoutPercent}% receive no follow-up so you can measure its lift.`}
                        </p>
                      </div>
                    </div>
                    {stepErrors.delay && (
                      <p id={`${delayId}-error`} role="alert" className="text-[11px] text-destructive">
                        {stepErrors.delay.join(", ")}
                      </p>
                    )}

                    <div className="space-y-1.5">
                      <Label htmlFor={messageId} className="text-[11px]">
                        Message
                      </Label>
                      <textarea
                        id={messageId}
                        rows={3}
                        value={step.message}
                        maxLength={FOLLOWUP_LIMITS.messageMax}
                        onChange={(event) => update(index, { message: event.target.value })}
                        aria-describedby={messageHelpId}
                        aria-invalid={Boolean(stepErrors.message)}
                        className="w-full p-3 rounded-xl border border-[#c7cad5] dark:border-border bg-background text-xs focus:border-[#4262ff] focus:ring-2 focus:ring-[#4262ff]/20 outline-none resize-none"
                      />
                      <p id={messageHelpId} className="text-[10px] text-muted-foreground">
                        Use {"{username}"} for their name and {"{link}"} for your destination.
                        {" "}{step.message.length}/{FOLLOWUP_LIMITS.messageMax}
                      </p>
                      {stepErrors.message && (
                        <p role="alert" className="text-[11px] text-destructive">
                          {stepErrors.message.join(", ")}
                        </p>
                      )}
                    </div>
                  </fieldset>
                </li>
              );
            })}
          </ol>
        )}

        {error && (
          <p role="alert" className="text-xs font-medium text-destructive">
            {error}
          </p>
        )}
        {status && (
          <p role="status" className="text-xs font-medium text-[#00b473]">
            {status}
          </p>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-[#e0e2e8] dark:border-border/60 pt-4">
          <p className="text-[11px] text-muted-foreground">
            Runs automatically once an hour. Steps {steps.length}/
            {FOLLOWUP_LIMITS.maxSteps}
          </p>
          <Button
            type="button"
            size="sm"
            onClick={save}
            disabled={saving || steps.length === 0}
            className="rounded-full text-xs font-semibold h-9 px-5 bg-[#1c1c1e] text-white hover:bg-[#2c2c34] dark:bg-[#ffd02f] dark:text-[#1c1c1e]"
          >
            {saving ? (
              <>
                <Loader2 className="size-3.5 mr-1.5 animate-spin" aria-hidden="true" />
                Saving…
              </>
            ) : (
              "Save follow-ups"
            )}
          </Button>
        </div>
      </Card>
    </section>
  );
}
