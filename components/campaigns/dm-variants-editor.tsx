"use client";

import { useId } from "react";
import { Layers, Plus, Trash2 } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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

export function DmVariantsEditor({
  primaryMessage,
  variants,
  onVariantsChange,
  disabled,
}: DmVariantsEditorProps) {
  const baseId = useId();
  const effective = normalizeDmVariants(variants, primaryMessage);

  const updateAt = (index: number, value: string) => {
    onVariantsChange(effective.map((item, i) => (i === index ? value : item)));
  };
  const removeAt = (index: number) => {
    onVariantsChange(effective.filter((_, i) => i !== index));
  };
  const add = () => onVariantsChange([...effective, ""]);

  return (
    <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 p-5 shadow-subtle space-y-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-0.5">
          <h3 className="font-semibold text-xs sm:text-sm text-foreground flex items-center gap-1.5">
            <Layers className="size-3.5 text-[#4262ff]" aria-hidden="true" />
            DM variations
          </h3>
          <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground max-w-lg">
            Write a few different ways to say the same thing. dmplease picks one at
            random for each person and never repeats the last one — identical replies
            are the strongest spam signal there is.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={add}
          disabled={disabled || effective.length >= DM_VARIANT_LIMITS.max}
          className="rounded-full text-xs h-9 px-4 shrink-0"
        >
          <Plus className="size-3.5 mr-1.5" aria-hidden="true" />
          Add variation
        </Button>
      </div>

      {effective.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#e0e2e8] dark:border-border px-4 py-5 text-center text-xs text-muted-foreground">
          Using only your main message. Add a variation to enable rotation.
        </p>
      ) : (
        <ol className="space-y-4">
          {effective.map((variant, index) => {
            const textareaId = `${baseId}-variant-${index}`;
            const labelId = `${baseId}-label-${index}`;
            return (
              <li
                key={index}
                className="rounded-xl border border-[#e0e2e8] dark:border-border px-4 py-3.5 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor={textareaId} id={labelId} className="text-[11px]">
                    Variation {index + 1}
                  </Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-destructive"
                    onClick={() => removeAt(index)}
                    disabled={disabled}
                    aria-label={`Remove variation ${index + 1}`}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
                <DmVariablePicker
                  textareaId={textareaId}
                  value={variant}
                  onChange={(next) => updateAt(index, next)}
                  disabled={disabled}
                />
                <textarea
                  id={textareaId}
                  rows={2}
                  value={variant}
                  maxLength={DM_VARIANT_LIMITS.maxLength}
                  onChange={(event) => updateAt(index, event.target.value)}
                  aria-describedby={labelId}
                  disabled={disabled}
                  className="w-full p-3 rounded-xl border border-[#c7cad5] dark:border-border bg-background text-xs focus:border-[#4262ff] focus:ring-2 focus:ring-[#4262ff]/20 outline-none resize-none"
                />
                <p className="text-[10px] text-muted-foreground text-right">
                  {variant.length}/{DM_VARIANT_LIMITS.maxLength}
                </p>
              </li>
            );
          })}
        </ol>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-[#e0e2e8] dark:border-border/60 pt-3">
        <p className="text-[11px] text-muted-foreground">
          {effective.length} of {DM_VARIANT_LIMITS.max} variations. Your main message is
          always available as a fallback.
        </p>
      </div>
    </Card>
  );
}
