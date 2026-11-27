"use client";

import { useMemo, useState } from "react";
import { Clock, Flame } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  buildCommentHeatmapInTimeZone,
  describePeak,
  heatmapStep,
  HEATMAP_DAY_SHORT,
  hourLabel,
} from "@/lib/heatmap";
import { getWeekdayOrder } from "@/lib/timezone";

const STEP_COLORS = [
  "rgba(107, 111, 126, 0.08)",
  "rgba(66, 98, 255, 0.18)",
  "rgba(66, 98, 255, 0.38)",
  "rgba(66, 98, 255, 0.58)",
  "rgba(66, 98, 255, 0.78)",
  "rgba(66, 98, 255, 0.98)",
] as const;

interface HoveredCell {
  day: number;
  hour: number;
  count: number;
}

export function CommentHeatmap({
  times,
  timeZone,
  weekStartsOn,
}: {
  times: string[];
  timeZone: string;
  weekStartsOn: number;
}) {
  const heatmap = useMemo(
    () => buildCommentHeatmapInTimeZone(times, timeZone),
    [times, timeZone]
  );
  const rowOrder = useMemo(() => getWeekdayOrder(weekStartsOn), [weekStartsOn]);
  const [hovered, setHovered] = useState<HoveredCell | null>(null);
  const peakLabel = describePeak(heatmap.peak);

  const detail = hovered
    ? `${HEATMAP_DAY_SHORT[hovered.day]} ${hourLabel(hovered.hour)} · ${hovered.count.toLocaleString()} comment${hovered.count === 1 ? "" : "s"}`
    : peakLabel
      ? `Peak: ${peakLabel} · ${heatmap.peak?.count.toLocaleString()} comment${heatmap.peak?.count === 1 ? "" : "s"}`
      : null;

  return (
    <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle">
      <CardHeader className="pb-4 border-b border-[#e0e2e8] dark:border-border/60">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base font-semibold tracking-tight flex items-center gap-2">
              <Flame className="size-4 text-[#f59e0b]" aria-hidden="true" />
              Best time to post
            </CardTitle>
            <CardDescription className="text-xs mt-0.5 text-[#555a6a] dark:text-muted-foreground">
              When your audience comments, by day and hour.
            </CardDescription>
          </div>
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock className="size-3" aria-hidden="true" />
            Workspace time ({timeZone})
          </span>
        </div>
      </CardHeader>
      <CardContent className="pt-5 space-y-4">
        {heatmap.total === 0 ? (
          <p role="status" className="py-8 text-center text-sm text-muted-foreground">
            No comments yet. Once people comment, this heatmap shows the best day
            and hour to post.
          </p>
        ) : (
          <>
            <div
              className="flex items-center justify-between gap-3 rounded-xl border border-[#f59e0b]/30 bg-[#fff8e0]/60 dark:bg-[#746019]/20 px-3.5 py-2.5"
              aria-live="polite"
            >
              <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground">
                {detail}
              </p>
              <span className="text-[10px] text-muted-foreground">
                {heatmap.total.toLocaleString()} comments
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-separate border-spacing-0.5 text-[10px]">
                <caption className="sr-only">
                  Comments by day of week and hour of day in the workspace timezone
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="w-10" aria-label="Day" />
                    {Array.from({ length: 24 }, (_, hour) => (
                      <th
                        key={hour}
                        scope="col"
                        className="pb-1 text-center font-medium text-muted-foreground"
                      >
                        {hour % 3 === 0 ? hourLabel(hour) : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rowOrder.map((day) => (
                    <tr key={day}>
                      <th
                        scope="row"
                        className="pr-2 text-right font-medium text-muted-foreground"
                      >
                        {HEATMAP_DAY_SHORT[day]}
                      </th>
                      {Array.from({ length: 24 }, (_, hour) => {
                        const count = heatmap.cells[day][hour];
                        const step = heatmapStep(count, heatmap.max);
                        const isPeak =
                          heatmap.peak?.day === day &&
                          heatmap.peak?.hour === hour &&
                          count > 0;
                        const isHovered =
                          hovered?.day === day && hovered?.hour === hour;
                        return (
                          <td key={hour} className="p-0">
                            <button
                              type="button"
                              onMouseEnter={() => setHovered({ day, hour, count })}
                              onMouseLeave={() => setHovered(null)}
                              onFocus={() => setHovered({ day, hour, count })}
                              onBlur={() => setHovered(null)}
                              aria-label={`${HEATMAP_DAY_SHORT[day]} ${hourLabel(hour)}, ${count} comment${count === 1 ? "" : "s"}`}
                              className={`block h-6 w-full rounded-[3px] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4262ff] ${
                                isPeak
                                  ? "ring-2 ring-[#4262ff] ring-offset-1 ring-offset-background"
                                  : ""
                              } ${isHovered ? "scale-110 shadow-sm" : ""}`}
                              style={{ backgroundColor: STEP_COLORS[step] }}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 text-[10px] text-muted-foreground">
              <span>Each cell is one hour. Darker = more comments.</span>
              <span className="inline-flex items-center gap-1.5">
                Fewer
                {STEP_COLORS.slice(1).map((color) => (
                  <span
                    key={color}
                    className="size-3 rounded-[3px]"
                    style={{ backgroundColor: color }}
                    aria-hidden="true"
                  />
                ))}
                More
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
