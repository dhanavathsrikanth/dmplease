import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import type { MetricComparison } from "@/lib/period-comparison";

interface DeltaBadgeProps {
  comparison: MetricComparison;
  /** Which direction is a good outcome. Defaults to "up". */
  goodDirection?: "up" | "down";
  /** Short label shown after the value, e.g. "vs prev 30d". */
  periodLabel?: string;
}

/**
 * Compact previous-period delta. Text + icon + colour, never colour alone,
 * and an aria-label so screen readers get the full sentence.
 */
export function DeltaBadge({
  comparison,
  goodDirection = "up",
  periodLabel = "vs previous period",
}: DeltaBadgeProps) {
  const { current, previous, deltaPercent, deltaPoints, direction } = comparison;

  if (deltaPercent === null && deltaPoints === null) {
    if (current > 0 && previous === 0) {
      return (
        <span
          className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-[#4262ff] dark:text-[#8b9eff]"
          aria-label={`New this period, ${periodLabel}`}
        >
          <ArrowUpRight className="size-3" aria-hidden="true" />
          New
        </span>
      );
    }
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[10px] font-medium text-muted-foreground"
        aria-label={`No change, ${periodLabel}`}
      >
        <Minus className="size-3" aria-hidden="true" />
        —
      </span>
    );
  }

  const isRate = deltaPoints !== null;
  const value = isRate
    ? `${deltaPoints! > 0 ? "+" : ""}${deltaPoints} pts`
    : `${deltaPercent! > 0 ? "+" : ""}${Math.round(deltaPercent!)}%`;

  const isGood =
    direction === "flat" ? null : direction === goodDirection;
  const color =
    isGood === null
      ? "text-muted-foreground"
      : isGood
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-rose-600 dark:text-rose-400";
  const Icon =
    direction === "up"
      ? ArrowUpRight
      : direction === "down"
        ? ArrowDownRight
        : Minus;

  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${color}`}
      aria-label={`${direction === "up" ? "Up" : direction === "down" ? "Down" : "No change"} ${value} ${periodLabel}`}
    >
      <Icon className="size-3" aria-hidden="true" />
      {value}
      <span className="font-normal text-muted-foreground">{periodLabel}</span>
    </span>
  );
}
