"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Layers, Pencil, Plus, Trash2, X } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DmVariablePicker } from "@/components/campaigns/dm-variable-picker";
import {
  DM_VARIANT_LIMITS,
  normalizeDmVariants,
} from "@/lib/dm-variants";

interface DmVariantsEditorProps {
  primaryMessage: string;
  variants: string[];
  onVariantsChange: (variants: string[]) => void;
  disabled?: boolean;
}

/**
 * Variations only support the Instagram username. Strip every other token and
 * keep at most one {username} so the delivered message is always predictable.
 */
function sanitizeVariant(value: string): string {
  let cleaned = value.replace(
    /\{\{?([a-zA-Z_][a-zA-Z0-9_]*)\}?\}/g,
    (_match, token: string) =>
      token.toLowerCase() === "username" ? "{username}" : ""
  );
  const first = cleaned.indexOf("{username}");
  if (first !== -1) {
    const before = cleaned.slice(0, first + "{username}".length);
    const after = cleaned
      .slice(first + "{username}".length)
      .replace(/\{username\}/g, "");
    cleaned = before + after;
  }
  return cleaned
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}

export function DmVariantsEditor({
  primaryMessage,
  variants,
  onVariantsChange,
  disabled,
}: DmVariantsEditorProps) {
  const effective = normalizeDmVariants(variants, primaryMessage);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(effective);

  const openDialog = () => {
    setDraft(effective.length > 0 ? effective : [""]);
    setOpen(true);
  };

  const updateAt = (index: number, value: string) => {
    setDraft((current) =>
      current.map((item, i) => (i === index ? value : item))
    );
  };
  const removeAt = (index: number) => {
    setDraft((current) => current.filter((_, i) => i !== index));
  };
  const add = () => setDraft((current) => [...current, ""]);

  const save = () => {
    onVariantsChange(
      draft.map(sanitizeVariant).filter((variant) => variant.length > 0)
    );
    setOpen(false);
  };

  return (
    <>
      <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 p-5 shadow-subtle space-y-3.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-0.5">
            <h3 className="font-semibold text-xs sm:text-sm text-foreground flex items-center gap-1.5">
              <Layers className="size-3.5 text-[#4262ff]" aria-hidden="true" />
              DM variations
            </h3>
            <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground max-w-lg">
              Write a few different ways to say the same thing. We rotate them so
              identical replies never repeat.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={openDialog}
            disabled={disabled}
            className="rounded-full text-xs h-9 px-4 shrink-0"
          >
            <Pencil className="size-3.5 mr-1.5" aria-hidden="true" />
            Edit variations
          </Button>
        </div>

        <div className="rounded-xl border border-[#e0e2e8] dark:border-border bg-[#f7f8fa] dark:bg-muted/30 px-4 py-3">
          {effective.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Using only your main message. Add variations to enable rotation.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-foreground">
                {effective.length} variation{effective.length === 1 ? "" : "s"}
              </p>
              {effective.slice(0, 3).map((variant, index) => (
                <p
                  key={index}
                  className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground"
                >
                  <span className="font-semibold text-foreground">
                    {index + 1}.
                  </span>{" "}
                  {variant}
                </p>
              ))}
              {effective.length > 3 && (
                <p className="text-[10px] text-muted-foreground">
                  +{effective.length - 3} more
                </p>
              )}
            </div>
          )}
        </div>
      </Card>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-border px-6 py-4">
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  DM variations
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  Write a few different ways to say the same thing. We rotate them
                  automatically and never repeat the last one.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full p-1 text-muted-foreground hover:bg-muted"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
              <div className="rounded-xl border border-[#e0e2e8] bg-[#f7f8fa] px-4 py-3 text-[11px] leading-relaxed text-muted-foreground dark:border-border dark:bg-muted/30">
                Variations support only the follower&apos;s Instagram handle. Use{" "}
                <code className="font-mono font-semibold text-foreground">
                  {"{username}"}
                </code>{" "}
                once per message — other variables are removed automatically.
              </div>
              {draft.map((variant, index) => {
                const textareaId = `dm-variant-${index}`;
                return (
                  <div
                    key={index}
                    className="space-y-2 rounded-xl border border-[#e0e2e8] p-4 dark:border-border"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-foreground">
                        Variation {index + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeAt(index)}
                        disabled={disabled || draft.length === 1}
                        aria-label={`Remove variation ${index + 1}`}
                        className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-40"
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </button>
                    </div>
                    <DmVariablePicker
                      textareaId={textareaId}
                      value={variant}
                      onChange={(next) => updateAt(index, next)}
                      tokens={["username"]}
                      disabled={disabled}
                    />
                    <textarea
                      id={textareaId}
                      rows={4}
                      value={variant}
                      maxLength={DM_VARIANT_LIMITS.maxLength}
                      onChange={(event) => updateAt(index, event.target.value)}
                      disabled={disabled}
                      placeholder="Hey {username}! Here is your free guide…"
                      className="w-full resize-none rounded-xl border border-[#c7cad5] bg-background p-3 text-xs outline-none focus:border-[#4262ff] focus:ring-2 focus:ring-[#4262ff]/20 dark:border-border"
                    />
                    <p className="text-right text-[10px] text-muted-foreground">
                      {variant.length}/{DM_VARIANT_LIMITS.maxLength}
                    </p>
                  </div>
                );
              })}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={add}
                disabled={disabled || draft.length >= DM_VARIANT_LIMITS.max}
                className="rounded-full text-[11px] h-8 px-3"
              >
                <Plus className="size-3.5 mr-1.5" aria-hidden="true" />
                Add variation
              </Button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-6 py-4">
              <p className="text-[11px] text-muted-foreground">
                {draft.length} of {DM_VARIANT_LIMITS.max} variations. Your main
                message is always available as a fallback.
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="button" onClick={save}>
                  Save variations
                </Button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
