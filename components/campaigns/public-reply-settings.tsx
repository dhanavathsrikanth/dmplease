"use client";

import { useId } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  normalizePublicReplies,
  PUBLIC_REPLY_DEFAULTS,
  PUBLIC_REPLY_DEFAULT,
  PUBLIC_REPLY_LIMITS,
} from "@/lib/public-replies";

interface PublicReplySettingsProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  messages: string[];
  onMessagesChange: (messages: string[]) => void;
  errors?: string[];
  disabled?: boolean;
}

export function PublicReplySettings({
  enabled,
  onEnabledChange,
  messages,
  onMessagesChange,
  errors,
  disabled,
}: PublicReplySettingsProps) {
  const baseId = useId();
  const toggleId = `${baseId}-toggle`;
  const helpId = `${baseId}-help`;
  const errorId = `${baseId}-error`;
  // The editor always shows the effective set, including the automatic
  // natural variants that keep a thread from repeating one same reply.
  const variants = normalizePublicReplies(messages);

  const updateAt = (index: number, value: string) => {
    onMessagesChange(variants.map((message, i) => (i === index ? value : message)));
  };
  const removeAt = (index: number) => {
    if (variants.length <= 1) return;
    onMessagesChange(variants.filter((_, i) => i !== index));
  };
  const addVariant = () => onMessagesChange([...variants, ""]);

  return (
    <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 p-5 shadow-subtle space-y-3.5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <h3 className="font-semibold text-xs sm:text-sm text-foreground">
            Public comment reply
          </h3>
          <p id={helpId} className="text-[11px] text-[#555a6a] dark:text-muted-foreground max-w-lg">
            Posts a reply under their comment so other followers see it. Add a few
            variants and we rotate between them, so replies never look copy-pasted.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Label htmlFor={toggleId} className="text-[11px] text-muted-foreground">
            {enabled ? "On" : "Off"}
          </Label>
          <Switch
            id={toggleId}
            checked={enabled}
            onCheckedChange={onEnabledChange}
            aria-describedby={helpId}
            disabled={disabled}
          />
        </div>
      </div>

      {enabled && (
        <div className="space-y-3 border-t border-[#e0e2e8] dark:border-border/60 pt-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#f5f3ff] dark:bg-[#4262ff]/10 px-3 py-2.5">
            <p className="text-[11px] leading-relaxed text-[#555a6a] dark:text-muted-foreground max-w-lg">
              dmplease keeps at least {PUBLIC_REPLY_LIMITS.minVariants} natural variants and
              picks a different one per commenter — never the same reply twice in a row.
            </p>
            <button
              type="button"
              onClick={() => onMessagesChange([...PUBLIC_REPLY_DEFAULTS])}
              disabled={disabled}
              className="text-[11px] font-semibold text-[#4262ff] hover:underline shrink-0"
            >
              Use suggested variants
            </button>
          </div>
          <ol className="space-y-3">
            {variants.map((message, index) => {
              const inputId = `${baseId}-variant-${index}`;
              const labelId = `${baseId}-variant-label-${index}`;
              return (
                <li key={index} className="space-y-1.5">
                  <Label htmlFor={inputId} id={labelId} className="text-[11px]">
                    Reply variant {index + 1}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id={inputId}
                      value={message}
                      onChange={(event) => updateAt(index, event.target.value)}
                      placeholder={PUBLIC_REPLY_DEFAULT}
                      maxLength={PUBLIC_REPLY_LIMITS.messageMax}
                      aria-describedby={`${baseId}-hint`}
                      disabled={disabled}
                      className="h-9 text-xs rounded-lg bg-[#f7f8fa] dark:bg-muted/40"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeAt(index)}
                      disabled={disabled || variants.length <= 1}
                      aria-label={`Remove reply variant ${index + 1}`}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p id={`${baseId}-hint`} className="text-[10px] text-muted-foreground">
                      Use {"{username}"} and {"{keyword}"} to personalise.{" "}
                      {message.length}/{PUBLIC_REPLY_LIMITS.messageMax}
                    </p>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => updateAt(index, `${message} {username}`.trim())}
                        disabled={disabled}
                        className="rounded-full border border-[#e0e2e8] dark:border-border px-2 py-0.5 text-[10px] font-mono text-muted-foreground hover:text-foreground"
                        aria-label={`Insert username into reply variant ${index + 1}`}
                      >
                        {"{username}"}
                      </button>
                      <button
                        type="button"
                        onClick={() => updateAt(index, `${message} {keyword}`.trim())}
                        disabled={disabled}
                        className="rounded-full border border-[#e0e2e8] dark:border-border px-2 py-0.5 text-[10px] font-mono text-muted-foreground hover:text-foreground"
                        aria-label={`Insert keyword into reply variant ${index + 1}`}
                      >
                        {"{keyword}"}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>

          {errors && errors.length > 0 && (
            <p id={errorId} role="alert" className="text-[11px] font-medium text-destructive">
              {errors.join(", ")}
            </p>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addVariant}
            disabled={disabled || variants.length >= PUBLIC_REPLY_LIMITS.maxMessages}
            className="rounded-full text-[11px] h-8 px-3"
          >
            <Plus className="size-3.5 mr-1.5" aria-hidden="true" />
            Add another reply ({variants.length}/{PUBLIC_REPLY_LIMITS.maxMessages})
          </Button>
        </div>
      )}
    </Card>
  );
}
