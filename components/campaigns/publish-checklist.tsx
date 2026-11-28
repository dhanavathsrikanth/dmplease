"use client";

import React from "react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  Circle,
  Loader2,
  Rocket,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ChecklistStatus = "complete" | "incomplete" | "optional";

export interface ChecklistItem {
  id: string;
  label: string;
  description?: string;
  status: ChecklistStatus;
  /** Element id inside the settings panel that fixes this item. */
  targetId?: string;
}

interface PublishChecklistProps {
  items: ChecklistItem[];
  canPublish: boolean;
  isEdit: boolean;
  publishStatus: "idle" | "publishing" | "success";
  onPublish: () => void;
  onFix: (targetId: string) => void;
  className?: string;
}

/**
 * A compact pre-flight panel shown beside the live preview. It turns the
 * builder's validation into a short, clickable list so a creator can see what
 * is missing and jump straight to the field that needs attention.
 */
export function PublishChecklist({
  items,
  canPublish,
  isEdit,
  publishStatus,
  onPublish,
  onFix,
  className,
}: PublishChecklistProps) {
  const required = items.filter((item) => item.status !== "optional");
  const complete = required.filter((item) => item.status === "complete");
  const incomplete = items.filter((item) => item.status === "incomplete");
  const progress =
    required.length === 0
      ? 100
      : Math.round((complete.length / required.length) * 100);

  return (
    <aside
      aria-label="Publish checklist"
      className={cn(
        "rounded-3xl border border-border bg-background p-4 shadow-subtle xl:sticky xl:top-0",
        className
      )}
    >
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-[#ffd02f]/25 text-[#8a6d1a] dark:bg-[#ffd02f]/10 dark:text-[#ffd02f]">
          <Rocket className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-xs font-semibold text-foreground">
            Publish checklist
          </h2>
          <p className="text-[10px] text-muted-foreground">
            {complete.length} of {required.length} required steps
          </p>
        </div>
      </div>

      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        aria-label="Publish readiness"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300",
            progress === 100 ? "bg-[#00b473]" : "bg-[#ffd02f]"
          )}
          style={{ width: `${progress}%` }}
        />
      </div>

      <ul className="mt-3 space-y-0.5">
        {items.map((item) => {
          const isIncomplete = item.status === "incomplete";
          const isOptional = item.status === "optional";
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => item.targetId && onFix(item.targetId)}
                className={cn(
                  "group flex w-full items-start gap-2 rounded-xl px-2 py-1.5 text-left transition-colors",
                  isIncomplete
                    ? "hover:bg-rose-50 dark:hover:bg-rose-500/10"
                    : "hover:bg-muted/50"
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border",
                    item.status === "complete"
                      ? "border-[#00b473] bg-[#00b473] text-white"
                      : isIncomplete
                        ? "border-rose-300 bg-rose-50 text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-400"
                        : "border-[#d4d9d9] text-[#b0b5c0] dark:border-border"
                  )}
                >
                  {item.status === "complete" ? (
                    <Check className="size-2.5 stroke-[3]" aria-hidden="true" />
                  ) : isIncomplete ? (
                    <AlertCircle className="size-2.5" aria-hidden="true" />
                  ) : (
                    <Circle className="size-2.5" aria-hidden="true" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block text-[11px] font-semibold leading-tight",
                      isIncomplete
                        ? "text-rose-600 dark:text-rose-400"
                        : isOptional
                          ? "text-muted-foreground"
                          : "text-foreground"
                    )}
                  >
                    {item.label}
                  </span>
                  {item.description && (
                    <span className="mt-0.5 block truncate text-[10px] leading-tight text-muted-foreground">
                      {item.description}
                    </span>
                  )}
                </span>
                {isIncomplete && (
                  <ArrowRight
                    className="mt-0.5 size-3 shrink-0 text-rose-500 opacity-0 transition-opacity group-hover:opacity-100"
                    aria-hidden="true"
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 border-t border-border pt-3">
        <Button
          type="button"
          onClick={onPublish}
          disabled={!canPublish || publishStatus === "publishing"}
          className={cn(
            "h-9 w-full rounded-full text-xs font-semibold",
            publishStatus === "success"
              ? "bg-[#00b473] text-white hover:bg-[#00a368]"
              : "bg-[#1c1c1e] text-white hover:bg-[#2c2c34] dark:bg-[#ffd02f] dark:text-[#1c1c1e] dark:hover:bg-[#fcb900]"
          )}
        >
          {publishStatus === "publishing" ? (
            <>
              <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
              {isEdit ? "Saving…" : "Going live…"}
            </>
          ) : publishStatus === "success" ? (
            <>
              <Check className="mr-1.5 size-3.5 stroke-[3]" aria-hidden="true" />
              {isEdit ? "Saved!" : "Live!"}
            </>
          ) : (
            <>
              {isEdit ? "Save changes" : "Go live"}
              <ArrowRight className="ml-1.5 size-3.5" aria-hidden="true" />
            </>
          )}
        </Button>
        {!canPublish && publishStatus === "idle" && (
          <p className="mt-2 text-center text-[10px] leading-relaxed text-muted-foreground">
            {incomplete.length > 0
              ? `Fix ${incomplete.length} item${incomplete.length === 1 ? "" : "s"} to publish.`
              : "Finish the required steps to publish."}
          </p>
        )}
      </div>
    </aside>
  );
}
