"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, History, Loader2, Play, X } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import posthog from "posthog-js";

interface RerunCampaign {
  id: string;
  name: string;
  active: boolean;
  postScope?: string | null;
}

interface JobStatus {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  total: number;
  sent: number;
  skipped: number;
  failed: number;
  pending: number;
  error_message: string | null;
  errors: string[];
}

const WINDOWS = [1, 7, 30] as const;

const TERMINAL = new Set<JobStatus["status"]>([
  "completed",
  "failed",
  "cancelled",
]);

interface RerunDialogProps {
  campaign: RerunCampaign | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted?: (counts: { sent: number; skipped: number; failed: number }) => void;
}

export function RerunDialog({
  campaign,
  open,
  onOpenChange,
  onCompleted,
}: RerunDialogProps) {
  const [days, setDays] = useState<number>(7);
  const [preview, setPreview] = useState<{
    count: number;
    sample: string[];
    total?: number;
    alreadyContacted?: number;
    optedOut?: number;
    accountUnavailable?: number;
  } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = useCallback(() => {
    setDays(7);
    setPreview(null);
    setJob(null);
    setError(null);
    setBusy(false);
    setLoadingPreview(false);
  }, []);

  useEffect(() => {
    if (!open) {
      reset();
    }
  }, [open, reset]);

  const loadPreview = useCallback(async () => {
    if (!campaign) return;
    setLoadingPreview(true);
    setError(null);
    setPreview(null);
    try {
      const res = await fetch("/api/campaigns/rerun", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: campaign.id, days, dryRun: true }),
      });
      const data = (await res.json()) as {
        count?: number;
        sample?: string[];
        total?: number;
        alreadyContacted?: number;
        optedOut?: number;
        accountUnavailable?: number;
        error?: string;
      };
      if (!res.ok || typeof data.count !== "number") {
        setError(data.error ?? "Could not preview this re-run.");
      } else {
        setPreview({
          count: data.count,
          sample: data.sample ?? [],
          total: data.total,
          alreadyContacted: data.alreadyContacted,
          optedOut: data.optedOut,
          accountUnavailable: data.accountUnavailable,
        });
      }
    } catch {
      setError("Network error while checking recent comments.");
    } finally {
      setLoadingPreview(false);
    }
  }, [campaign, days]);

  useEffect(() => {
    if (open && campaign && !job) void loadPreview();
    // Preview is only refreshed on open / window change; `job` gates it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, campaign?.id, days]);

  const refreshJob = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/campaigns/rerun/${jobId}`, { cache: "no-store" });
      const data = (await res.json()) as JobStatus & { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not load re-run progress.");
        return;
      }
      setJob(data);
      if (TERMINAL.has(data.status)) {
        setBusy(false);
        if (data.status === "completed") {
          posthog.capture("campaign_rerun_completed", {
            sent: data.sent,
            skipped: data.skipped,
            failed: data.failed,
          });
          onCompleted?.({
            sent: data.sent,
            skipped: data.skipped,
            failed: data.failed,
          });
        }
      }
    } catch {
      setError("Network error while checking re-run progress.");
    }
  }, [onCompleted]);

  useEffect(() => {
    if (!job || TERMINAL.has(job.status)) return;
    const timer = setInterval(() => void refreshJob(job.id), 2000);
    return () => clearInterval(timer);
  }, [job, refreshJob]);

  const start = async () => {
    if (!campaign) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/campaigns/rerun", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: campaign.id, days, dryRun: false }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        jobId?: string | null;
        message?: string;
        error?: string;
        status?: string;
      };
      if (res.status === 409 && data.jobId) {
        // A re-run is already active; attach to it instead of starting another.
        await refreshJob(data.jobId);
        return;
      }
      if (!res.ok || !data.success) {
        setError(data.error ?? "Could not start the re-run.");
        setBusy(false);
        return;
      }
      if (!data.jobId) {
        setPreview({ count: 0, sample: [] });
        setBusy(false);
        return;
      }
      posthog.capture("campaign_rerun_started", {
        total: preview?.count ?? 0,
        days,
        post_scope: campaign.postScope ?? "unknown",
      });
      await refreshJob(data.jobId);
    } catch {
      setError("Network error while starting the re-run.");
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!job) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/rerun/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        setError(data.error ?? "Could not cancel the re-run.");
        setBusy(false);
        return;
      }
      await refreshJob(job.id);
      setBusy(false);
    } catch {
      setError("Network error while cancelling the re-run.");
      setBusy(false);
    }
  };

  const processed = job
    ? Math.min(job.total, job.sent + job.skipped + job.failed)
    : 0;
  const progress = job && job.total > 0 ? Math.round((processed / job.total) * 100) : 0;
  const isActive = Boolean(job && !TERMINAL.has(job.status));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md rounded-3xl p-6">
        <DialogHeader className="space-y-2">
          <div className="size-10 rounded-2xl bg-[#f5f3ff] text-[#4262ff] dark:bg-[#4262ff]/20 flex items-center justify-center">
            <History className="size-5" aria-hidden="true" />
          </div>
          <DialogTitle className="text-lg font-bold font-rubik text-foreground">
            Re-run recent comments
          </DialogTitle>
          <DialogDescription className="text-xs text-[#555a6a] dark:text-muted-foreground leading-relaxed">
            Apply &ldquo;{campaign?.name}&rdquo; to comments that matched its keywords.
            Anyone already contacted by this campaign in the last 30 days, or who
            opted out, is skipped automatically.
          </DialogDescription>
        </DialogHeader>

        {!job ? (
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold text-foreground">
                Look back
              </legend>
              <div className="flex gap-2">
                {WINDOWS.map((value) => (
                  <label
                    key={value}
                    className={`flex-1 cursor-pointer rounded-xl border px-3 py-2 text-center text-xs font-medium transition-colors ${
                      days === value
                        ? "border-[#4262ff] bg-[#f5f3ff] text-[#4262ff] dark:bg-[#4262ff]/10"
                        : "border-[#e0e2e8] dark:border-border text-muted-foreground"
                    }`}
                  >
                    <input
                      type="radio"
                      name="rerun-window"
                      className="sr-only"
                      value={value}
                      checked={days === value}
                      onChange={() => setDays(value)}
                      disabled={busy || loadingPreview}
                    />
                    {value} day{value === 1 ? "" : "s"}
                  </label>
                ))}
              </div>
            </fieldset>

            {loadingPreview ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                Checking recent comments…
              </div>
            ) : preview ? (
              <div className="rounded-2xl border border-[#ffd02f]/40 bg-[#fff8e0]/60 dark:bg-[#746019]/20 p-4 space-y-2">
                <div className="flex items-end gap-2">
                  <p className="text-2xl font-bold text-foreground">{preview.count}</p>
                  <p className="text-xs text-[#555a6a] dark:text-muted-foreground pb-1">
                    eligible commenter{preview.count === 1 ? "" : "s"} in the last {days} day
                    {days === 1 ? "" : "s"}.
                  </p>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
                  {typeof preview.total === "number" && (
                    <span>{preview.total} matched the keyword</span>
                  )}
                  {(preview.alreadyContacted ?? 0) > 0 && (
                    <span>{preview.alreadyContacted} already contacted</span>
                  )}
                  {(preview.optedOut ?? 0) > 0 && (
                    <span>{preview.optedOut} opted out</span>
                  )}
                  {(preview.accountUnavailable ?? 0) > 0 && (
                    <span>{preview.accountUnavailable} account paused</span>
                  )}
                </div>
                {preview.sample.length > 0 && (
                  <p className="text-[10px] text-muted-foreground truncate">
                    e.g. {preview.sample.join(", ")}
                  </p>
                )}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-4" aria-live="polite">
            <div className="flex items-center justify-between gap-3">
              <Badge
                variant={job.status === "completed" ? "tag-teal" : "outline"}
                className="text-[10px] font-semibold rounded-full px-3 capitalize"
              >
                {job.status}
              </Badge>
              <span className="text-xs font-semibold text-foreground">{progress}%</span>
            </div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              aria-label="Re-run progress"
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-[#4262ff] transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                { label: "Sent", value: job.sent },
                { label: "Skipped", value: job.skipped },
                { label: "Failed", value: job.failed },
                { label: "Pending", value: job.pending },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-[#e0e2e8] dark:border-border py-2">
                  <p className="text-sm font-bold text-foreground">{item.value}</p>
                  <p className="text-[10px] text-muted-foreground">{item.label}</p>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {job.total} recipient{job.total === 1 ? "" : "s"} total · updated automatically
            </p>
            {job.error_message && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                {job.error_message}
              </p>
            )}
            {job.errors.length > 0 && (
              <ul className="space-y-1 text-[10px] text-muted-foreground">
                {job.errors.map((message, index) => (
                  <li key={index} className="truncate">• {message}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {error && (
          <div
            role="alert"
            aria-live="assertive"
            className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-center gap-2"
          >
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            {error}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0 pt-3">
          {job ? (
            isActive ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={busy}
                  className="rounded-full text-xs font-semibold h-9"
                >
                  Close
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={cancel}
                  disabled={busy}
                  className="rounded-full text-xs font-semibold h-9"
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <X className="size-3.5 mr-1.5" aria-hidden="true" />}
                  Stop re-run
                </Button>
              </>
            ) : (
              <Button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-full text-xs font-semibold h-9 bg-[#1c1c1e] text-white dark:bg-[#ffd02f] dark:text-[#1c1c1e]"
              >
                <Check className="size-3.5 mr-1.5" aria-hidden="true" />
                Done
              </Button>
            )
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={busy || loadingPreview}
                className="rounded-full text-xs font-semibold h-9"
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={busy || loadingPreview || error !== null || (preview?.count ?? 0) === 0}
                onClick={start}
                className="rounded-full text-xs font-semibold h-9 bg-[#1c1c1e] text-white dark:bg-[#ffd02f] dark:text-[#1c1c1e]"
              >
                {busy ? (
                  <>
                    <Loader2 className="size-3.5 mr-1.5 animate-spin" aria-hidden="true" />
                    Starting…
                  </>
                ) : (
                  <>
                    <Play className="size-3.5 mr-1.5" aria-hidden="true" />
                    Start re-run
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
