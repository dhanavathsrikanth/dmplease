"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import {
  Megaphone,
  MessageCircle,
  Search,
  Trash2,
  AlertTriangle,
  Loader2,
  ShieldCheck,
  Check,
  RotateCcw,
  Pencil,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toggleCampaignActive, deleteCampaign } from "@/app/dashboard/campaigns/actions";
import { RerunDialog } from "@/components/campaigns/rerun-dialog";

export interface AutomationItem {
  id: string;
  name: string;
  goal?: string | null;
  triggerType?: string | null;
  postScope?: string | null;
  postId?: string | null;
  postThumbnailUrl?: string | null;
  postCaption?: string | null;
  triggerKeywords: string[];
  dmMessage: string;
  buttonText?: string | null;
  buttonUrl?: string | null;
  publicReplyEnabled?: boolean | null;
  publicReplyMessages?: string[] | null;
  followGateEnabled?: boolean | null;
  active: boolean;
}

interface CampaignsListProps {
  initialAutomations: AutomationItem[];
  logCountsByAutoId: Record<string, number>;
}

export function CampaignsList({
  initialAutomations,
  logCountsByAutoId,
}: CampaignsListProps) {
  const router = useRouter();
  const [automations, setAutomations] = useState<AutomationItem[]>(initialAutomations);
  const [activeTab, setActiveTab] = useState<"all" | "active" | "paused">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AutomationItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [rerunTarget, setRerunTarget] = useState<AutomationItem | null>(null);
  const [rerunOpen, setRerunOpen] = useState(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleToggle = async (id: string, currentActive: boolean) => {
    const nextActive = !currentActive;
    setTogglingId(id);

    // Optimistic UI update
    setAutomations((prev) =>
      prev.map((a) => (a.id === id ? { ...a, active: nextActive } : a))
    );

    try {
      const res = await toggleCampaignActive(id, nextActive);
      if (!res.success) {
        // Revert
        setAutomations((prev) =>
          prev.map((a) => (a.id === id ? { ...a, active: currentActive } : a))
        );
        showToast(`Failed to update campaign: ${res.error || "Unknown error"}`);
      } else {
        posthog.capture("campaign_status_changed", {
          active: nextActive,
        });
        showToast(nextActive ? "Campaign activated" : "Campaign paused");
      }
    } catch {
      setAutomations((prev) =>
        prev.map((a) => (a.id === id ? { ...a, active: currentActive } : a))
      );
      showToast("Error updating campaign status");
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);

    try {
      const res = await deleteCampaign(deleteTarget.id);
      if (res.success) {
        posthog.capture("campaign_deleted", {
          post_scope: deleteTarget.postScope ?? "unknown",
          was_active: deleteTarget.active,
        });
        setAutomations((prev) => prev.filter((a) => a.id !== deleteTarget.id));
        showToast(`Deleted "${deleteTarget.name}"`);
        setDeleteTarget(null);
      } else {
        showToast(`Could not delete campaign: ${res.error}`);
      }
    } catch {
      showToast("Error deleting campaign");
    } finally {
      setIsDeleting(false);
    }
  };

  const openRerun = (auto: AutomationItem) => {
    setRerunTarget(auto);
    setRerunOpen(true);
  };

  const filteredAutomations = automations.filter((auto) => {
    const matchesTab =
      activeTab === "all"
        ? true
        : activeTab === "active"
        ? auto.active
        : !auto.active;

    const q = searchQuery.toLowerCase();
    const matchesQuery =
      !q ||
      auto.name.toLowerCase().includes(q) ||
      auto.dmMessage.toLowerCase().includes(q) ||
      (auto.triggerKeywords || []).some((k) => k.toLowerCase().includes(q));

    return matchesTab && matchesQuery;
  });

  const activeCount = automations.filter((a) => a.active).length;
  const pausedCount = automations.filter((a) => !a.active).length;

  return (
    <div className="space-y-5">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-3 duration-200">
          <div className="bg-[#1c1c1e] text-white dark:bg-white dark:text-[#1c1c1e] text-xs font-medium px-4 py-2.5 rounded-full shadow-lg flex items-center gap-2">
            <Check className="size-3.5 text-[#00b473]" />
            <span>{toastMessage}</span>
          </div>
        </div>
      )}

      {/* Controls Bar: Tabs & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 p-1 rounded-full bg-[#f0f2f5] dark:bg-muted/60 border border-[#e0e2e8] dark:border-border/60 w-fit">
          <button
            onClick={() => setActiveTab("all")}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
              activeTab === "all"
                ? "bg-white dark:bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            All ({automations.length})
          </button>
          <button
            onClick={() => setActiveTab("active")}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
              activeTab === "active"
                ? "bg-white dark:bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Active ({activeCount})
          </button>
          <button
            onClick={() => setActiveTab("paused")}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
              activeTab === "paused"
                ? "bg-white dark:bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Paused ({pausedCount})
          </button>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="size-3.5 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search campaigns & keywords..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-xs rounded-full bg-[#f7f8fa] dark:bg-muted/40 border-[#e0e2e8] dark:border-border"
          />
        </div>
      </div>

      {/* Campaigns Cards */}
      {filteredAutomations.length > 0 ? (
        <div className="grid gap-3.5">
          {filteredAutomations.map((auto) => (
            <Card
              key={auto.id}
              className={`rounded-2xl glass-card liquid-sheen border shadow-subtle transition-all p-5 ${
                auto.active
                  ? "border-[#e0e2e8] dark:border-border/80 hover:border-[#c7cad5]"
                  : "border-dashed border-[#d0d3dc] dark:border-border/40 opacity-75 bg-[#fcfcfd] dark:bg-card/40"
              }`}
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-start gap-3.5 flex-1 min-w-0">
                  {auto.postThumbnailUrl && (
                    <div className="relative size-14 rounded-xl overflow-hidden border border-[#e0e2e8] shrink-0 shadow-xs">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={auto.postThumbnailUrl}
                        alt={auto.name}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute bottom-0 inset-x-0 bg-black/70 text-[9px] text-white text-center py-0.5 font-bold uppercase tracking-wider">
                        Post
                      </div>
                    </div>
                  )}

                  <div className="space-y-2 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-foreground truncate">
                        {auto.name}
                      </span>
                      {auto.active ? (
                        <Badge
                          variant="tag-teal"
                          className="text-[10px] py-0.5 px-2.5 font-semibold"
                        >
                          Active
                        </Badge>
                      ) : (
                        <Badge
                          variant="secondary"
                          className="text-[10px] py-0.5 px-2.5 font-medium text-muted-foreground"
                        >
                          Paused
                        </Badge>
                      )}
                      {auto.postScope === "SPECIFIC_POST" ? (
                        <Badge variant="outline" className="text-[10px] font-medium rounded-full">
                          Targeted Post
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px] font-medium rounded-full">
                          All Posts &amp; Reels
                        </Badge>
                      )}
                      {auto.followGateEnabled && (
                        <Badge
                          variant="outline"
                          className="text-[10px] py-0.5 px-2 rounded-full border-[#00b473]/40 text-[#00b473] font-medium flex items-center gap-1"
                        >
                          <ShieldCheck className="size-2.5" />
                          Follow-Gated
                        </Badge>
                      )}
                      {auto.publicReplyEnabled && (
                        <Badge
                          variant="outline"
                          className="text-[10px] py-0.5 px-2 rounded-full border-[#ffd02f]/50 text-[#746019] dark:text-[#ffd02f] font-medium"
                        >
                          Comment Reply
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-xs text-[#555a6a] dark:text-muted-foreground">
                      {auto.triggerType === "SHARE_TO_DM" ? (
                        <>
                          <span className="font-medium text-foreground text-xs">Trigger:</span>
                          <span className="px-2.5 py-0.5 rounded-full bg-[#f5f3ff] text-[#4262ff] dark:bg-[#4262ff]/20 dark:text-[#8b9eff] font-medium text-xs">
                            Share to DM
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="font-medium text-foreground text-xs">Keywords:</span>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {(auto.triggerKeywords || []).map((kw, i) => (
                              <span
                                key={i}
                                className="px-2.5 py-0.5 rounded-full bg-[#1c1c1e] text-white font-mono font-medium text-xs dark:bg-white dark:text-[#1c1c1e]"
                              >
                                {kw}
                              </span>
                            ))}
                          </div>
                        </>
                      )}
                    </div>

                    <div className="p-3 rounded-xl bg-[#f7f8fa] dark:bg-muted/40 border border-[#e0e2e8] dark:border-border/60 text-xs text-foreground font-sans flex items-center gap-2">
                      <MessageCircle className="size-3.5 text-[#0fbcb0] shrink-0" />
                      <span className="line-clamp-2">&ldquo;{auto.dmMessage}&rdquo;</span>
                    </div>
                  </div>
                </div>

                <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-3 shrink-0 border-t sm:border-t-0 pt-3 sm:pt-0 border-[#e0e2e8] dark:border-border/60">
                  <div className="text-left sm:text-right">
                    <p className="text-[10px] font-semibold uppercase text-[#6b6f7e]">Dispatched</p>
                    <p className="text-base font-bold text-foreground">
                      {logCountsByAutoId[auto.id] || 0} DMs
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        {auto.active ? "Active" : "Paused"}
                      </span>
                      <Switch
                        checked={auto.active}
                        disabled={togglingId === auto.id}
                        onCheckedChange={() => handleToggle(auto.id, auto.active)}
                        aria-label={`Toggle ${auto.name}`}
                      />
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      asChild
                      aria-label={`Edit ${auto.name}`}
                      title="Edit Campaign"
                      className="rounded-full h-8 px-3 text-[11px] font-semibold gap-1.5"
                    >
                      <Link href={`/dashboard/campaigns/${auto.id}/edit`}>
                        <Pencil className="size-3.5" />
                        <span className="hidden lg:inline">Edit</span>
                      </Link>
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openRerun(auto)}
                      aria-label={`Re-run last 7 days for ${auto.name}`}
                      title="Re-run last 7 days"
                      className="rounded-full h-8 px-3 text-[11px] font-semibold gap-1.5"
                    >
                      <RotateCcw className="size-3.5" />
                      <span className="hidden lg:inline">Re-run last 7 days</span>
                    </Button>

                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteTarget(auto)}
                      className="size-8 rounded-full text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                      title="Delete Campaign"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="rounded-3xl border-dashed p-10 text-center space-y-4">
          <div className="size-11 rounded-2xl bg-[#fff8e0] text-[#746019] flex items-center justify-center mx-auto shadow-xs">
            <Megaphone className="size-5" />
          </div>
          <div>
            <h3 className="font-semibold text-base text-foreground">
              {searchQuery ? "No matching campaigns found" : "No campaigns found"}
            </h3>
            <p className="text-xs text-[#555a6a] dark:text-muted-foreground max-w-md mx-auto mt-1">
              {searchQuery
                ? `No campaigns matched your search "${searchQuery}". Try a different keyword.`
                : "Create a campaign to automatically dispatch direct messages when followers comment on your posts."}
            </p>
          </div>
          {!searchQuery && (
            <Button asChild size="sm" className="rounded-full font-semibold text-xs mt-2 bg-[#1c1c1e] hover:bg-[#2c2c34] text-white px-6 h-9">
              <Link href="/dashboard/campaigns/new">Create Your First Campaign</Link>
            </Button>
          )}
        </Card>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md rounded-3xl p-6">
          <DialogHeader className="space-y-2">
            <div className="size-10 rounded-2xl bg-rose-50 text-rose-600 dark:bg-rose-950/40 flex items-center justify-center">
              <AlertTriangle className="size-5" />
            </div>
            <DialogTitle className="text-lg font-bold font-rubik text-foreground">
              Delete Campaign?
            </DialogTitle>
            <DialogDescription className="text-xs text-[#555a6a] dark:text-muted-foreground leading-relaxed">
              Are you sure you want to delete <span className="font-semibold text-foreground">&ldquo;{deleteTarget?.name}&rdquo;</span>? This will permanently stop automated comment triggers for this campaign.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0 pt-3">
            <Button
              type="button"
              variant="outline"
              disabled={isDeleting}
              onClick={() => setDeleteTarget(null)}
              className="rounded-full text-xs font-semibold h-9"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isDeleting}
              onClick={handleDelete}
              className="rounded-full text-xs font-semibold h-9 bg-rose-600 hover:bg-rose-700 text-white"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete Campaign"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Durable, progress-tracked re-run */}
      <RerunDialog
        campaign={rerunTarget}
        open={rerunOpen}
        onOpenChange={(next) => {
          setRerunOpen(next);
          if (!next) setRerunTarget(null);
        }}
        onCompleted={({ sent, skipped, failed }) => {
          showToast(
            `Re-run finished: ${sent} sent, ${skipped} skipped, ${failed} failed`
          );
          router.refresh();
        }}
      />
    </div>
  );
}
