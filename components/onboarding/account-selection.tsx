"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  filterSelectableAccounts,
  summarizeSelection,
} from "@/lib/account-selection";

interface AvailableAccount {
  instagramBusinessId: string;
  facebookPageId: string | null;
  username: string;
  displayName: string | null;
  profilePictureUrl: string | null;
  followersCount: number;
  isVerified: boolean;
  connected: boolean;
}

interface ConnectResult {
  username: string;
  instagramBusinessId: string;
  status: "created" | "skipped" | "failed";
  error?: string;
}

interface AccountSelectionProps {
  pendingId: string;
  redirectTo: string;
  onCancel?: () => void;
}

export function AccountSelection({
  pendingId,
  redirectTo,
  onCancel,
}: AccountSelectionProps) {
  const [accounts, setAccounts] = useState<AvailableAccount[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ConnectResult[] | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/instagram/pending/${pendingId}`, {
        cache: "no-store",
      });
      const json = (await response.json()) as {
        success?: boolean;
        accounts?: AvailableAccount[];
        expiresAt?: string;
        error?: string;
      };
      if (!response.ok || !json.success) {
        setError(json.error ?? "Could not load the account list.");
        return;
      }
      setAccounts(json.accounts ?? []);
      setExpiresAt(json.expiresAt ?? null);
      setSelected(new Set());
    } catch {
      setError("Network error while loading accounts.");
    } finally {
      setLoading(false);
    }
  }, [pendingId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () => filterSelectableAccounts(accounts, search),
    [accounts, search]
  );
  const summary = useMemo(
    () => summarizeSelection(accounts, selected),
    [accounts, selected]
  );

  const selectable = filtered.filter((account) => !account.connected);
  const allSelected =
    selectable.length > 0 &&
    selectable.every((account) => selected.has(account.instagramBusinessId));

  const toggle = (id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectable.map((account) => account.instagramBusinessId)));
    }
  };

  const connect = async (ids: string[]) => {
    if (ids.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/instagram/accounts/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingId, accountIds: ids }),
      });
      const json = (await response.json()) as {
        success?: boolean;
        created?: number;
        skipped?: number;
        failed?: number;
        results?: ConnectResult[];
        error?: string;
      };
      if (!response.ok) {
        setError(json.error ?? "Could not connect the selected accounts.");
        return;
      }
      setResults(json.results ?? []);
      if ((json.failed ?? 0) === 0) {
        const created = json.created ?? 0;
        window.location.href = `${redirectTo}?status=connected&accounts=${created}`;
        return;
      }
      await load();
    } catch {
      setError("Network error while connecting accounts.");
    } finally {
      setBusy(false);
    }
  };

  const failed = (results ?? []).filter((result) => result.status === "failed");
  const created = (results ?? []).filter((result) => result.status === "created").length;
  const skipped = (results ?? []).filter((result) => result.status === "skipped").length;

  return (
    <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle bg-card p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="size-10 rounded-xl bg-[#f5f3ff] dark:bg-[#4262ff]/20 flex items-center justify-center shrink-0">
            <Users className="size-5 text-[#4262ff]" aria-hidden="true" />
          </div>
          <div className="space-y-0.5">
            <h2 className="font-semibold text-sm text-foreground">
              Select Instagram accounts
            </h2>
            <p className="text-xs text-[#555a6a] dark:text-muted-foreground max-w-lg">
              Choose which accounts to connect. Each selected account gets its own
              isolated workspace. Already-connected accounts are skipped.
            </p>
          </div>
        </div>
        <Badge variant="outline" className="text-[10px] font-semibold rounded-full px-3 shrink-0">
          {summary.selected} selected
        </Badge>
      </div>

      {expiresAt && (
        <p className="text-[10px] text-muted-foreground">
          This selection expires at{" "}
          {new Date(expiresAt).toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
          })}
          .
        </p>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="relative flex-1">
          <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by username or page name…"
            aria-label="Search accounts"
            className="h-9 pl-9 text-xs rounded-lg"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={toggleAll}
          disabled={loading || selectable.length === 0}
          className="h-9 text-[11px] rounded-full px-4"
        >
          {allSelected ? "Clear all" : "Select all"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => void load()}
          disabled={loading || busy}
          aria-label="Refresh account list"
          className="size-9 shrink-0"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
        </Button>
      </div>

      <div className="max-h-80 overflow-y-auto rounded-xl border border-[#e0e2e8] dark:border-border divide-y divide-[#e0e2e8] dark:divide-border">
        {loading ? (
          <div className="p-8 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading accounts…
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground">
            {accounts.length === 0
              ? "No Instagram accounts were returned by Meta."
              : "No accounts match your search."}
          </div>
        ) : (
          filtered.map((account) => {
            const isSelected = selected.has(account.instagramBusinessId);
            return (
              <label
                key={account.instagramBusinessId}
                className={`flex items-center gap-3 p-3 ${
                  account.connected
                    ? "opacity-60 cursor-not-allowed"
                    : "cursor-pointer hover:bg-muted/40"
                }`}
              >
                <Checkbox
                  checked={account.connected || isSelected}
                  disabled={account.connected || busy}
                  onCheckedChange={(checked) =>
                    toggle(account.instagramBusinessId, checked === true)
                  }
                  aria-label={`Select @${account.username}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-foreground truncate">
                    @{account.username}
                    {account.isVerified && (
                      <span className="ml-1 text-[#0095f6]" aria-label="Verified">
                        ✓
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {account.displayName || "Instagram account"} ·{" "}
                    {account.followersCount.toLocaleString()} followers
                  </p>
                </div>
                {account.connected && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="size-3" aria-hidden="true" />
                    Connected
                  </span>
                )}
              </label>
            );
          })
        )}
      </div>

      {results && (
        <div className="rounded-xl border border-[#e0e2e8] dark:border-border p-3.5 space-y-2">
          <p className="text-xs font-semibold text-foreground">Connection results</p>
          <div className="flex flex-wrap gap-3 text-[11px]">
            <span className="text-emerald-600 dark:text-emerald-400">
              {created} created
            </span>
            <span className="text-muted-foreground">{skipped} skipped</span>
            <span className={failed.length > 0 ? "text-destructive" : "text-muted-foreground"}>
              {failed.length} failed
            </span>
          </div>
          {failed.length > 0 && (
            <ul className="space-y-1 text-[10px] text-muted-foreground">
              {failed.map((result) => (
                <li key={result.instagramBusinessId} className="truncate">
                  @{result.username}: {result.error ?? "Unknown error"}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-[11px] font-medium text-destructive flex items-center gap-1.5">
          <AlertCircle className="size-3.5" aria-hidden="true" />
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <p className="text-[11px] text-muted-foreground">
          {summary.createCount === 0
            ? "Select at least one account to continue."
            : `Create ${summary.createCount} workspace${summary.createCount === 1 ? "" : "s"}.`}
        </p>
        <div className="flex gap-2">
          {onCancel && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={busy}
              className="h-9 text-[11px] rounded-full px-4"
            >
              Cancel
            </Button>
          )}
          {failed.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void connect(failed.map((result) => result.instagramBusinessId))}
              disabled={busy}
              className="h-9 text-[11px] rounded-full px-4"
            >
              <RefreshCw className="size-3.5 mr-1.5" aria-hidden="true" />
              Retry failed
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            onClick={() => void connect([...selected])}
            disabled={busy || summary.createCount === 0}
            className="h-9 text-xs font-semibold rounded-full px-5 bg-[#1c1c1e] text-white dark:bg-[#ffd02f] dark:text-[#1c1c1e]"
          >
            {busy ? (
              <>
                <Loader2 className="size-3.5 mr-1.5 animate-spin" aria-hidden="true" />
                Connecting…
              </>
            ) : (
              `Create ${summary.createCount || ""} workspace${summary.createCount === 1 ? "" : "s"}`
            )}
          </Button>
        </div>
      </div>
    </Card>
  );
}
