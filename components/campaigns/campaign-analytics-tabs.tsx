"use client";

import { useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CalendarDays, Check, Loader2, Save, X } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deleteAnalyticsView,
  saveAnalyticsView,
  type AnalyticsView,
} from "@/app/dashboard/campaigns/analytics-view-actions";

const RANGES = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
] as const;

type RangeKind = "7d" | "30d" | "90d" | "custom";

interface CampaignAnalyticsTabsProps {
  days: number;
  from: string;
  to: string;
  rangeKind: RangeKind;
  activeTab: string;
  savedViews: AnalyticsView[];
  workspaceId: string;
  timeZone: string;
  overview: ReactNode;
  comments: ReactNode;
  shares: ReactNode;
  links: ReactNode;
  followups: ReactNode;
  followGate: ReactNode;
}

/**
 * Analytics workspace: tabs, a 7/30/90/custom range picker, and saved views.
 * The range and tab live in the URL so a view is shareable and bookmarkable.
 */
export function CampaignAnalyticsTabs({
  days,
  from,
  to,
  rangeKind,
  activeTab,
  savedViews,
  workspaceId,
  timeZone,
  overview,
  comments,
  shares,
  links,
  followups,
  followGate,
}: CampaignAnalyticsTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [showCustom, setShowCustom] = useState(rangeKind === "custom");
  const [customFrom, setCustomFrom] = useState(from);
  const [customTo, setCustomTo] = useState(to);
  const [showSave, setShowSave] = useState(false);
  const [viewName, setViewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const navigate = (params: URLSearchParams) => {
    router.push(`${pathname}?${params.toString()}`);
  };

  const applyRange = (kind: RangeKind, nextFrom?: string, nextTo?: string) => {
    setError(null);
    const params = new URLSearchParams();
    if (kind === "custom") {
      if (!nextFrom || !nextTo) {
        setError("Choose both a start and end date.");
        return;
      }
      if (nextFrom > nextTo) {
        setError("The start date must be before the end date.");
        return;
      }
      params.set("from", nextFrom);
      params.set("to", nextTo);
    } else {
      params.set("range", kind);
    }
    params.set("tab", activeTab);
    navigate(params);
  };

  const applyView = (view: AnalyticsView) => {
    const params = new URLSearchParams();
    if (view.rangeKind === "custom" && view.from && view.to) {
      params.set("from", view.from);
      params.set("to", view.to);
    } else {
      params.set("range", view.rangeKind);
    }
    params.set("tab", view.tab);
    navigate(params);
  };

  const changeTab = (tab: string) => {
    const params = new URLSearchParams();
    if (rangeKind === "custom") {
      params.set("from", from);
      params.set("to", to);
    } else {
      params.set("range", rangeKind);
    }
    params.set("tab", tab);
    navigate(params);
  };

  const saveView = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const result = await saveAnalyticsView({
        workspaceId,
        name: viewName,
        rangeKind,
        from: rangeKind === "custom" ? from : null,
        to: rangeKind === "custom" ? to : null,
        tab: activeTab,
      });
      if (!result.success) {
        setError(result.error ?? "Could not save the view.");
        return;
      }
      setSaved(true);
      setShowSave(false);
      setViewName("");
      router.refresh();
    } catch {
      setError("Network error while saving the view.");
    } finally {
      setBusy(false);
    }
  };

  const removeView = async (view: AnalyticsView) => {
    setBusy(true);
    setError(null);
    try {
      const result = await deleteAnalyticsView(view.id, workspaceId);
      if (!result.success) {
        setError(result.error ?? "Could not delete the view.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error while deleting the view.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3" aria-label="Campaign analytics">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            Performance
          </h2>
          <p className="text-xs text-[#555a6a] dark:text-muted-foreground mt-0.5">
            {rangeKind === "custom"
              ? `${from} → ${to} · ${days} days`
              : `Last ${days} days`}{" "}
            · {timeZone} · measured from stored events.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex items-center gap-1 p-1 rounded-full bg-[#f0f2f5] dark:bg-muted/60 border border-[#e0e2e8] dark:border-border/60 w-fit"
            role="group"
            aria-label="Analytics date range"
          >
            {RANGES.map((range) => (
              <button
                key={range.value}
                type="button"
                onClick={() => {
                  setShowCustom(false);
                  applyRange(range.value);
                }}
                aria-pressed={rangeKind === range.value}
                className={`px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all ${
                  rangeKind === range.value
                    ? "bg-white dark:bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {range.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowCustom((value) => !value)}
              aria-pressed={rangeKind === "custom"}
              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all ${
                rangeKind === "custom"
                  ? "bg-white dark:bg-card text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <CalendarDays className="size-3" aria-hidden="true" />
              Custom
            </button>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowSave((value) => !value)}
            className="rounded-full h-8 text-[11px] font-semibold gap-1.5"
          >
            <Save className="size-3.5" aria-hidden="true" />
            Save view
          </Button>
        </div>
      </div>

      {showCustom && (
        <div className="rounded-2xl border border-[#e0e2e8] dark:border-border p-3.5 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="analytics-from" className="text-[10px]">
              From
            </Label>
            <Input
              id="analytics-from"
              type="date"
              value={customFrom}
              max={customTo || undefined}
              onChange={(event) => setCustomFrom(event.target.value)}
              className="h-8 text-xs w-[150px]"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="analytics-to" className="text-[10px]">
              To
            </Label>
            <Input
              id="analytics-to"
              type="date"
              value={customTo}
              min={customFrom || undefined}
              onChange={(event) => setCustomTo(event.target.value)}
              className="h-8 text-xs w-[150px]"
            />
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => applyRange("custom", customFrom, customTo)}
            className="h-8 text-[11px] rounded-full px-4"
          >
            Apply range
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowCustom(false)}
            className="h-8 text-[11px] rounded-full px-3"
          >
            Cancel
          </Button>
        </div>
      )}

      {showSave && (
        <div className="rounded-2xl border border-[#e0e2e8] dark:border-border p-3.5 flex flex-wrap items-end gap-3">
          <div className="space-y-1 flex-1 min-w-[200px]">
            <Label htmlFor="analytics-view-name" className="text-[10px]">
              View name
            </Label>
            <Input
              id="analytics-view-name"
              value={viewName}
              onChange={(event) => setViewName(event.target.value)}
              placeholder="e.g. Launch week, Last 7 days"
              maxLength={60}
              className="h-8 text-xs"
            />
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => void saveView()}
            disabled={busy || !viewName.trim()}
            className="h-8 text-[11px] rounded-full px-4"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="size-3.5" aria-hidden="true" />
            )}
            Save
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowSave(false)}
            className="h-8 text-[11px] rounded-full px-3"
          >
            Cancel
          </Button>
        </div>
      )}

      {savedViews.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Saved views">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[#6b6f7e]">
            Saved views
          </span>
          {savedViews.map((view) => (
            <span
              key={view.id}
              className="inline-flex items-center gap-1 rounded-full border border-[#e0e2e8] dark:border-border bg-[#f7f8fa] dark:bg-muted/30 pl-2.5 pr-1 py-0.5 text-[10px] font-medium"
            >
              <button
                type="button"
                onClick={() => applyView(view)}
                className="hover:text-[#4262ff] hover:underline"
                aria-label={`Apply saved view ${view.name}`}
              >
                {view.name}
              </button>
              <button
                type="button"
                onClick={() => void removeView(view)}
                disabled={busy}
                aria-label={`Delete saved view ${view.name}`}
                className="text-muted-foreground hover:text-destructive disabled:opacity-40"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="text-[11px] font-medium text-destructive">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
          View saved.
        </p>
      )}

      <Tabs value={activeTab} onValueChange={changeTab}>
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="comments">Comments</TabsTrigger>
          <TabsTrigger value="shares">Shares</TabsTrigger>
          <TabsTrigger value="links">Links</TabsTrigger>
          <TabsTrigger value="followups">Follow-ups</TabsTrigger>
          <TabsTrigger value="followgate">Follow gate</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">{overview}</TabsContent>
        <TabsContent value="comments">{comments}</TabsContent>
        <TabsContent value="shares">{shares}</TabsContent>
        <TabsContent value="links">{links}</TabsContent>
        <TabsContent value="followups">{followups}</TabsContent>
        <TabsContent value="followgate">{followGate}</TabsContent>
      </Tabs>
    </section>
  );
}
