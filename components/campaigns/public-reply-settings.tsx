"use client";

import { useId } from "react";
import { MessageSquare, Plus, Trash2 } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  normalizePublicReplies,
  PUBLIC_REPLY_DEFAULT,
  PUBLIC_REPLY_LIMITS,
} from "@/lib/public-replies";

const REPLY_LIMITS = [50, 200, 400, 800];

interface PublicReplySettingsProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  messages: string[];
  onMessagesChange: (messages: string[]) => void;
  limit: number;
  onLimitChange: (limit: number) => void;
  errors?: string[];
  disabled?: boolean;
}

export function PublicReplySettings({
  enabled,
  onEnabledChange,
  messages,
  onMessagesChange,
  limit,
  onLimitChange,
  errors,
  disabled,
}: PublicReplySettingsProps) {
  const baseId = useId();
  const toggleId = `${baseId}-toggle`;
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
  const toggleToken = (index: number, token: string) => {
    const message = variants[index] ?? "";
    const escaped = token.replace(/[{}]/g, "\\$&");
    const hasToken = new RegExp(escaped, "i").test(message);
    const next = hasToken
      ? message.replace(new RegExp(`\\s*${escaped}`, "gi"), "").trim()
      : `${message} ${token}`.trim();
    updateAt(index, next);
  };

  return (
    <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 p-5 shadow-subtle space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h3 className="font-semibold text-sm text-foreground">
          Public reply to comments
        </h3>
        <Switch
          id={toggleId}
          checked={enabled}
          onCheckedChange={onEnabledChange}
          disabled={disabled}
          aria-label="Public reply to comments"
        />
      </div>

      {enabled && (
        <>
          <div className="space-y-0.5">
            <h4 className="text-sm font-semibold text-foreground">Replies</h4>
            <p className="text-[11px] text-muted-foreground">
              A variant will be selected at random to avoid repetition.
            </p>
          </div>

          <div className="space-y-2">
            {variants.map((message, index) => (
              <div
                key={index}
                className="rounded-xl border border-[#e0e2e8] bg-background px-3 py-2 dark:border-border"
              >
                <div className="flex items-center gap-2">
                  <MessageSquare
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <input
                    value={message}
                    onChange={(event) => updateAt(index, event.target.value)}
                    placeholder={PUBLIC_REPLY_DEFAULT}
                    maxLength={PUBLIC_REPLY_LIMITS.messageMax}
                    disabled={disabled}
                    aria-label={`Reply variant ${index + 1}`}
                    className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  />
                  <button
                    type="button"
                    onClick={() => updateAt(index, `${message} 😀`.trim())}
                    disabled={disabled}
                    aria-label={`Insert emoji into reply variant ${index + 1}`}
                    className="grid size-7 shrink-0 place-items-center rounded-md text-base leading-none hover:bg-muted"
                  >
                    😀
                  </button>
                  <button
                    type="button"
                    onClick={() => removeAt(index)}
                    disabled={disabled || variants.length <= 1}
                    aria-label={`Remove reply variant ${index + 1}`}
                    className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-40"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </button>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-6">
                  <button
                    type="button"
                    onClick={() => toggleToken(index, "{username}")}
                    disabled={disabled}
                    className={cn(
                      "rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors",
                      message.toLowerCase().includes("{username}")
                        ? "border-[#6a06e4] bg-[#6a06e4]/10 text-[#6a06e4]"
                        : "border-[#e0e2e8] text-muted-foreground hover:text-foreground dark:border-border"
                    )}
                    aria-label={`Toggle username in reply variant ${index + 1}`}
                    aria-pressed={message.toLowerCase().includes("{username}")}
                  >
                    {"{username}"}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleToken(index, "{keyword}")}
                    disabled={disabled}
                    className={cn(
                      "rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors",
                      message.toLowerCase().includes("{keyword}")
                        ? "border-[#6a06e4] bg-[#6a06e4]/10 text-[#6a06e4]"
                        : "border-[#e0e2e8] text-muted-foreground hover:text-foreground dark:border-border"
                    )}
                    aria-label={`Toggle keyword in reply variant ${index + 1}`}
                    aria-pressed={message.toLowerCase().includes("{keyword}")}
                  >
                    {"{keyword}"}
                  </button>
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {message.length}/{PUBLIC_REPLY_LIMITS.messageMax}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {errors && errors.length > 0 && (
            <p id={errorId} role="alert" className="text-[11px] font-medium text-destructive">
              {errors.join(", ")}
            </p>
          )}

          <button
            type="button"
            onClick={addVariant}
            disabled={disabled || variants.length >= PUBLIC_REPLY_LIMITS.maxMessages}
            className="flex w-full items-center gap-2 rounded-xl border border-[#e0e2e8] bg-background px-3 py-2 text-sm font-semibold text-[#6a06e4] disabled:opacity-50 dark:border-border"
          >
            <span className="grid size-5 place-items-center rounded-md border border-[#6a06e4]/30">
              <Plus className="size-3" aria-hidden="true" />
            </span>
            Add Public Reply
          </button>

          <div className="space-y-2 border-t border-[#e0e2e8] pt-3 dark:border-border">
            <h4 className="text-sm font-semibold text-foreground">
              Limit public replies
            </h4>
            <p className="text-[11px] text-muted-foreground">
              Some comments are skipped automatically to avoid spam detection
            </p>
            <div className="grid grid-cols-4 gap-1 rounded-xl bg-[#f1f1f1] p-1 dark:bg-muted/40">
              {REPLY_LIMITS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onLimitChange(value)}
                  disabled={disabled}
                  className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
                    limit === value
                      ? "bg-white text-[#1d2842] shadow-sm dark:bg-background dark:text-foreground"
                      : "text-[#8c919f] hover:text-[#1d2842] dark:text-muted-foreground dark:hover:text-foreground"
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
