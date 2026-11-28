"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  saveWorkspacePreferences,
  type WorkspacePreferencesInput,
} from "@/app/dashboard/settings/actions";
import {
  DEFAULT_TIMEZONE,
  DEFAULT_WEEK_START,
  WEEKDAY_LABELS,
} from "@/lib/timezone";

const FALLBACK_TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Africa/Johannesburg",
  "UTC",
];

function listTimeZones(): string[] {
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf?.("timeZone");
    if (supported && supported.length > 0) {
      return Array.from(new Set([DEFAULT_TIMEZONE, ...supported])).sort();
    }
  } catch {
    // Older browsers: fall through to the curated list.
  }
  return FALLBACK_TIMEZONES;
}

function offsetLabel(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date());
    return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

export function WorkspacePreferencesSettings({
  workspaceId,
  initialTimezone,
  initialWeekStartsOn,
}: {
  workspaceId: string;
  initialTimezone: string;
  initialWeekStartsOn: number;
}) {
  const timeZones = useMemo(listTimeZones, []);
  // Offset labels come from the browser's Intl data, which can disagree with
  // Node's for the same zone. Render the zone names during hydration and add
  // the offsets after mount so the server and client markup match.
  const [offsetsReady, setOffsetsReady] = useState(false);
  useEffect(() => setOffsetsReady(true), []);
  const zoneLabels = useMemo(
    () =>
      new Map(
        timeZones.map((zone) => [
          zone,
          offsetsReady
            ? `${zone.replace(/_/g, " ")} (${offsetLabel(zone)})`
            : zone.replace(/_/g, " "),
        ])
      ),
    [offsetsReady, timeZones]
  );
  const [timezone, setTimezone] = useState(initialTimezone || DEFAULT_TIMEZONE);
  const [weekStartsOn, setWeekStartsOn] = useState(
    Number.isInteger(initialWeekStartsOn)
      ? initialWeekStartsOn
      : DEFAULT_WEEK_START
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const dirty =
    timezone !== initialTimezone || weekStartsOn !== initialWeekStartsOn;

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const payload: WorkspacePreferencesInput = {
      workspaceId,
      timezone,
      weekStartsOn,
    };
    try {
      const result = await saveWorkspacePreferences(payload);
      if (!result.success) {
        setError(result.error ?? "Could not save your time zone.");
        return;
      }
      setNotice("Saved. Analytics and timestamps now use this time zone.");
    } catch {
      setError("Network error while saving your time zone.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Choose the clock used across the whole platform. Date ranges, the
        day-by-hour heatmap, weekly totals, and every timestamp follow this time
        zone. Data is still stored in UTC, so nothing is lost when you change it.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="workspace-timezone" className="text-[11px]">
            Time zone
          </Label>
          <select
            id="workspace-timezone"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            className="h-9 w-full rounded-lg border border-[#e0e2e8] dark:border-border bg-background px-2.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {timeZones.map((zone) => (
              <option key={zone} value={zone}>
                {zoneLabels.get(zone)}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-muted-foreground">
            Default is Asia/Kolkata (IST) for Indian creators.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="workspace-week-start" className="text-[11px]">
            Week starts on
          </Label>
          <select
            id="workspace-week-start"
            value={weekStartsOn}
            onChange={(event) => setWeekStartsOn(Number(event.target.value))}
            className="h-9 w-full rounded-lg border border-[#e0e2e8] dark:border-border bg-background px-2.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {WEEKDAY_LABELS.map((label, index) => (
              <option key={label} value={index}>
                {label}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-muted-foreground">
            Weekly totals and the heatmap rows start on this day.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => void save()}
          disabled={busy || !dirty}
          className="rounded-full h-8 text-[11px] font-semibold gap-1.5"
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="size-3.5" aria-hidden="true" />
          )}
          Save time zone
        </Button>
        {!dirty && !busy && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Check className="size-3" aria-hidden="true" />
            Up to date
          </span>
        )}
      </div>

      {error && (
        <p role="alert" className="text-[11px] font-medium text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400"
        >
          {notice}
        </p>
      )}
    </div>
  );
}
