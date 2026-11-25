"use client";

import { useState } from "react";
import { CheckCircle2, Layers3, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface AvailableAccount {
  instagramBusinessId: string;
  username: string;
  displayName: string | null;
  followersCount: number;
  connected: boolean;
}

export function BulkConnect({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [accounts, setAccounts] = useState<AvailableAccount[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function loadAccounts() {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/instagram/accounts");
      const json = (await response.json()) as {
        success?: boolean;
        accounts?: AvailableAccount[];
        message?: string;
        error?: string;
      };
      if (!response.ok || !json.success) {
        setMessage(json.error ?? "Could not load accounts.");
        setAccounts([]);
        return;
      }
      setAccounts(json.accounts ?? []);
      if (json.message) setMessage(json.message);
      setSelected(new Set());
    } catch {
      setMessage("Network error while loading accounts.");
    } finally {
      setLoading(false);
    }
  }

  function toggle(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function connect() {
    const chosen = accounts.filter(
      (account) => selected.has(account.instagramBusinessId) && !account.connected
    );
    if (chosen.length === 0) return;

    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/instagram/accounts/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accounts: chosen.map((account) => ({
            instagramBusinessId: account.instagramBusinessId,
            username: account.username,
            displayName: account.displayName,
          })),
        }),
      });
      const json = (await response.json()) as {
        success?: boolean;
        created?: number;
        error?: string;
      };
      if (!response.ok || !json.success) {
        setMessage(json.error ?? "Could not connect the selected accounts.");
        return;
      }
      setMessage(`${json.created ?? 0} workspace${json.created === 1 ? "" : "s"} created.`);
      await loadAccounts();
    } catch {
      setMessage("Network error while connecting accounts.");
    } finally {
      setBusy(false);
    }
  }

  const filtered = accounts.filter((account) =>
    `${account.username} ${account.displayName ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );
  return (
    <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle bg-card p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="size-9 rounded-xl bg-[#fff8e0] dark:bg-[#746019]/30 flex items-center justify-center shrink-0">
            <Layers3 className="size-4 text-[#746019] dark:text-[#ffd02f]" aria-hidden="true" />
          </div>
          <div className="space-y-0.5">
            <p className="font-semibold text-sm text-foreground">Multiple accounts</p>
            <p className="text-xs text-[#555a6a] dark:text-muted-foreground">
              Connect several Instagram accounts at once. Each gets its own isolated workspace.
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="rounded-full text-xs h-9 px-4 shrink-0 border-[#c7cad5]"
          onClick={() => {
            setOpen(true);
            void loadAccounts();
          }}
        >
          {enabled ? "Add accounts in bulk" : "Connect one account first"}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Connect multiple accounts</DialogTitle>
            <DialogDescription>
              Choose the Instagram accounts you want to add. Accounts already connected are skipped.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="relative">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search accounts…"
                aria-label="Search accounts"
                className="h-9 text-xs rounded-lg"
              />
            </div>

            {message && (
              <p role="status" className="text-xs font-medium text-[#746019] dark:text-[#ffd02f]">
                {message}
              </p>
            )}

            <div className="max-h-72 overflow-y-auto rounded-xl border border-[#e0e2e8] dark:border-border divide-y divide-[#e0e2e8] dark:divide-border">
              {loading ? (
                <div className="p-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading accounts…
                </div>
              ) : filtered.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  No additional accounts found for this Meta identity.
                </div>
              ) : (
                filtered.map((account) => (
                  <label
                    key={account.instagramBusinessId}
                    className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/40"
                  >
                    <Checkbox
                      checked={selected.has(account.instagramBusinessId)}
                      disabled={account.connected}
                      onCheckedChange={(checked) =>
                        toggle(account.instagramBusinessId, checked === true)
                      }
                      aria-label={`Select @${account.username}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-foreground truncate">@{account.username}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {account.displayName || "Instagram account"} · {account.followersCount.toLocaleString()} followers
                      </p>
                    </div>
                    {account.connected && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
                        <CheckCircle2 className="size-3" aria-hidden="true" /> Connected
                      </span>
                    )}
                  </label>
                ))
              )}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              size="sm"
              variant="outline"
              className="rounded-full text-xs h-9 px-4"
              onClick={() => void loadAccounts()}
              disabled={loading || busy}
            >
              <RefreshCw className="size-3.5 mr-1.5" aria-hidden="true" /> Refresh
            </Button>
            <Button
              size="sm"
              className="rounded-full text-xs h-9 px-5 font-semibold bg-[#1c1c1e] text-white dark:bg-[#ffd02f] dark:text-[#1c1c1e]"
              disabled={selected.size === 0 || busy}
              onClick={() => void connect()}
            >
              {busy ? (
                <>
                  <Loader2 className="size-3.5 mr-1.5 animate-spin" aria-hidden="true" /> Connecting…
                </>
              ) : (
                `Create ${selected.size || ""} workspace${selected.size === 1 ? "" : "s"}`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
