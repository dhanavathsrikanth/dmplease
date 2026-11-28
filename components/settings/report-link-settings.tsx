"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Loader2, RefreshCw, ShieldOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  createReportLink,
  revokeReportLink,
  setReportLinkEnabled,
  type ReportLinkView,
} from "@/app/dashboard/settings/report-actions";

interface ReportLinkSettingsProps {
  workspaceId: string;
  initialLink: ReportLinkView | null;
}

export function ReportLinkSettings({
  workspaceId,
  initialLink,
}: ReportLinkSettingsProps) {
  const [link, setLink] = useState<ReportLinkView | null>(initialLink);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // `window` is unavailable during the server render, so resolve the origin
  // after mount. Rendering a relative path on both sides avoids a hydration
  // mismatch when a report link already exists.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const url = link ? `${origin}/report/${link.token}` : "";

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Could not copy the link. Select it and copy manually.");
    }
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await createReportLink(workspaceId);
      if (!result.success || !result.token) {
        setError(result.error ?? "Could not create the report link.");
        return;
      }
      setLink({
        id: "new",
        token: result.token,
        enabled: true,
        createdAt: new Date().toISOString(),
      });
      setNotice("New report link created. The previous link was revoked.");
    } catch {
      setError("Network error while creating the link.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (enabled: boolean) => {
    if (!link) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await setReportLinkEnabled(link.id, workspaceId, enabled);
      if (!result.success) {
        setError(result.error ?? "Could not update the link.");
        return;
      }
      setLink({ ...link, enabled });
      setNotice(enabled ? "Public report enabled." : "Public report disabled.");
    } catch {
      setError("Network error while updating the link.");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!link) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await revokeReportLink(link.id, workspaceId);
      if (!result.success) {
        setError(result.error ?? "Could not revoke the link.");
        return;
      }
      setLink(null);
      setNotice("Report link revoked. It can no longer be opened.");
    } catch {
      setError("Network error while revoking the link.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Share a read-only performance report with a client or teammate. The link
        shows DMs, delivery rate, opt-ins, clicks, conversions, keyword
        distribution, trend, and per-campaign/per-account breakdowns. You can
        disable or revoke it at any time.
      </p>

      {link ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="report-link" className="text-[11px]">
              Public report link
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="report-link"
                readOnly
                value={url}
                className="h-9 text-xs font-mono"
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => void copy()}
                aria-label="Copy report link"
                className="size-9 shrink-0"
              >
                {copied ? (
                  <Check className="size-3.5" aria-hidden="true" />
                ) : (
                  <Copy className="size-3.5" aria-hidden="true" />
                )}
              </Button>
              <Button
                asChild
                variant="outline"
                size="icon"
                className="size-9 shrink-0"
              >
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open report in a new tab"
                >
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-[#e0e2e8] dark:border-border px-3.5 py-2.5">
            <div>
              <p className="text-xs font-semibold text-foreground">Public access</p>
              <p className="text-[10px] text-muted-foreground">
                {link.enabled
                  ? "Anyone with the link can view the read-only report."
                  : "The link is disabled and will not open."}
              </p>
            </div>
            <Switch
              checked={link.enabled}
              onCheckedChange={(checked) => void toggle(checked)}
              disabled={busy}
              aria-label="Enable public report"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void create()}
              disabled={busy}
              className="rounded-full h-8 text-[11px] font-semibold gap-1.5"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="size-3.5" aria-hidden="true" />
              )}
              Generate new link
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => void revoke()}
              disabled={busy}
              className="rounded-full h-8 text-[11px] font-semibold gap-1.5"
            >
              <ShieldOff className="size-3.5" aria-hidden="true" />
              Revoke link
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          onClick={() => void create()}
          disabled={busy}
          className="rounded-full h-9 text-xs font-semibold gap-1.5"
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <ExternalLink className="size-3.5" aria-hidden="true" />
          )}
          Create public report link
        </Button>
      )}

      {error && (
        <p role="alert" className="text-[11px] font-medium text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
          {notice}
        </p>
      )}
    </div>
  );
}
