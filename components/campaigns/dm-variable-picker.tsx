"use client";

import { useId } from "react";
import { Info, Sparkles } from "lucide-react";

import {
  DM_VARIABLES,
  findDmVariables,
  type DmVariableToken,
} from "@/lib/dm-variables";

interface DmVariablePickerProps {
  /** id of the textarea the token should be inserted into. */
  textareaId: string;
  value: string;
  onChange: (next: string) => void;
  /** Set when a contact variable is used but no lead field is collected. */
  uncollectedVariables?: DmVariableToken[];
  disabled?: boolean;
}

const CONTACT_TOKENS: DmVariableToken[] = ["name", "email", "phone"];

export function DmVariablePicker({
  textareaId,
  value,
  onChange,
  uncollectedVariables = [],
  disabled,
}: DmVariablePickerProps) {
  const helpId = useId();
  const used = new Set(findDmVariables(value));

  const insert = (token: DmVariableToken) => {
    const snippet = `{${token}}`;
    const field = document.getElementById(textareaId) as HTMLTextAreaElement | null;
    if (!field) {
      onChange(`${value}${value.endsWith(" ") ? "" : " "}${snippet}`);
      return;
    }
    const start = field.selectionStart ?? value.length;
    const end = field.selectionEnd ?? start;
    onChange(`${value.slice(0, start)}${snippet}${value.slice(end)}`);
    requestAnimationFrame(() => {
      field.focus();
      const caret = start + snippet.length;
      field.setSelectionRange(caret, caret);
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Sparkles className="size-3 text-[#ffd02f]" aria-hidden="true" />
        <span className="text-[11px] font-semibold text-[#6b6f7e]">
          Personalise your message
        </span>
      </div>

      <ul className="flex flex-wrap gap-1.5" aria-label="Available message variables">
        {DM_VARIABLES.map((variable) => {
          const token = variable.token as DmVariableToken;
          const isUsed = used.has(token);
          return (
            <li key={variable.token}>
              <button
                type="button"
                onClick={() => insert(token)}
                disabled={disabled}
                title={variable.description}
                aria-label={`Insert ${variable.label} — ${variable.description}`}
                aria-pressed={isUsed}
                className={`px-2.5 py-1 rounded-full border text-[11px] font-mono transition-colors ${
                  isUsed
                    ? "border-[#4262ff] bg-[#f5f3ff] text-[#4262ff] dark:bg-[#4262ff]/10"
                    : "border-[#e0e2e8] dark:border-border bg-[#f7f8fa] dark:bg-muted/30 text-foreground hover:bg-[#eef0f3]"
                }`}
              >
                {`{${variable.token}}`}
              </button>
            </li>
          );
        })}
      </ul>

      <p id={helpId} className="text-[10px] leading-relaxed text-muted-foreground">
        Click a token to insert it where your cursor is. Both <code>{"{name}"}</code> and{" "}
        <code>{"{{name}}"}</code> work. <code>{"{voucher}"}</code> creates a unique code for
        every person automatically — no setup needed.
      </p>

      {uncollectedVariables.length > 0 && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg border border-[#ffd02f]/40 bg-[#fff8e0]/60 dark:bg-[#746019]/20 px-3 py-2 text-[11px] text-[#555a6a] dark:text-muted-foreground"
        >
          <Info className="size-3.5 mt-0.5 shrink-0 text-[#b8860b]" aria-hidden="true" />
          <span>
            You used{" "}
            <strong className="font-mono">{uncollectedVariables.map((v) => `{${v}}`).join(", ")}</strong>
            , but no lead field is selected. Turn on <strong>Collect details</strong> below so
            dmplease can fill those values; otherwise followers will see a friendly fallback.
          </span>
        </p>
      )}
    </div>
  );
}

export { CONTACT_TOKENS };
