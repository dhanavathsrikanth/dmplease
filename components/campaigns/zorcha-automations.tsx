"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  BookOpen,
  Bot,
  Calendar,
  Check,
  Inbox,
  Loader2,
  Mail,
  Megaphone,
  MessageCircle,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingUp,
  Users,
  Workflow,
  Zap,
} from "lucide-react";

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
import {
  CAMPAIGN_TEMPLATES,
  type CampaignTemplate,
} from "@/lib/campaign-templates";

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

interface ZorchaAutomationsProps {
  initialAutomations: AutomationItem[];
  logCountsByAutoId: Record<string, number>;
  created?: boolean;
  saved?: boolean;
}

type TabId = "active" | "archived" | "all";

const TABS: Array<{ id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "active", label: "Active", icon: Zap },
  { id: "archived", label: "Archived", icon: Archive },
  { id: "all", label: "All Triggers", icon: Sparkles },
];

const TEMPLATE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  message: MessageCircle,
  zap: Zap,
  bot: Bot,
  inbox: Inbox,
  story: Sparkles,
  users: Users,
  mail: Mail,
  trending: TrendingUp,
  book: BookOpen,
  calendar: Calendar,
  plus: Plus,
};

function TemplatesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="zorcha-ui !bg-[var(--z-bg-light)] !border-[var(--z-line)] max-h-[85vh] overflow-y-auto rounded-3xl border-2 p-0 shadow-[rgba(190,193,214,0.25)_0px_4px_10px_-1px] sm:max-w-3xl">
        <DialogHeader className="flex flex-row items-center justify-between border-b border-[var(--z-line)] p-4 pb-3 sm:p-6 sm:pb-3">
          <DialogTitle className="flex items-center gap-1.5 text-lg font-semibold text-[var(--z-black)]">
            Templates
            <span className="text-sm font-normal text-[var(--z-black-light)]">/</span>
            <span className="text-sm font-normal text-[var(--z-black-light)]">
              New Automation
            </span>
          </DialogTitle>
          <DialogDescription className="sr-only">
            Choose a template or build a flow from scratch.
          </DialogDescription>
        </DialogHeader>

        <div className="p-4 sm:p-6">
          {/* Flow Builder */}
          <Link
            href="/dashboard/campaigns/new"
            onClick={() => onOpenChange(false)}
            className="group relative flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-dashed border-[var(--z-line-dark)] bg-[var(--z-bg-light)]/50 px-4 py-3 transition-colors hover:bg-[var(--z-line)]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--z-primary)] focus-visible:ring-offset-2 md:flex-nowrap md:py-1"
          >
            <div className="flex min-w-0 flex-1 flex-col items-start gap-2 md:flex-row md:items-center">
              <div className="flex shrink-0 items-center rounded-[10px] border border-[#6600A2]/10 px-1.5 py-1">
                <Workflow className="mr-2 size-3.5 text-[var(--z-primary)]" aria-hidden="true" />
                <span className="whitespace-nowrap text-xs font-semibold text-[var(--z-primary)]">
                  Flow Builder
                </span>
              </div>
              <span className="text-sm font-semibold text-[var(--z-black)]">
                Build Your Flow, Your Way
              </span>
            </div>
            <span className="relative z-10 order-last flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--z-primary)]/5 px-3 text-sm font-semibold text-[var(--z-black)] md:order-none md:w-auto md:bg-transparent">
              <Play className="size-4" aria-hidden="true" />
              See Tutorial
            </span>
            <ArrowRight
              className="size-4 shrink-0 text-[var(--z-black-light)] transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </Link>

          {/* Templates */}
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {CAMPAIGN_TEMPLATES.map((template: CampaignTemplate) => {
              const Icon = TEMPLATE_ICONS[template.icon] ?? Sparkles;
              return (
                <Link
                  key={template.id}
                  href={template.href}
                  onClick={() => onOpenChange(false)}
                  className="group relative flex h-full w-full flex-col overflow-hidden rounded-[14px] border border-[var(--z-line)] bg-[var(--z-bg-light)] transition-colors hover:bg-[var(--z-line)]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--z-primary)] focus-visible:ring-offset-2"
                >
                  <div className="flex w-full flex-col items-start space-y-2 px-3">
                    <div className="mt-4 flex gap-x-2">
                      <div className="flex items-center rounded-[10px] border border-[#6600A2]/10 px-1.5 py-1">
                        <Zap className="mr-1.5 size-3 text-[var(--z-primary)]" aria-hidden="true" />
                        <span className="text-xs font-semibold text-[var(--z-primary)]">
                          Instant
                        </span>
                      </div>
                      {template.badge && (
                        <span className="z-shiny flex items-center gap-1 rounded-[10px] px-2 py-0.5 text-xs font-extrabold tracking-widest text-[var(--z-black)] ring-1 ring-white/50">
                          {template.badge}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-base font-semibold text-[var(--z-black)]">
                      <Icon className="size-4 text-[var(--z-black-light)]" aria-hidden="true" />
                      {template.title}
                    </div>
                    <div className="mb-4 text-left text-sm text-[var(--z-black-light)]">
                      {template.description}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ZorchaAutomations({
  initialAutomations,
  logCountsByAutoId,
  created = false,
  saved = false,
}: ZorchaAutomationsProps) {
  const router = useRouter();
  const [automations, setAutomations] = useState<AutomationItem[]>(initialAutomations);
  const [activeTab, setActiveTab] = useState<TabId>("active");
  const [searchQuery, setSearchQuery] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AutomationItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [rerunTarget, setRerunTarget] = useState<AutomationItem | null>(null);
  const [rerunOpen, setRerunOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleToggle = async (id: string, currentActive: boolean) => {
    const nextActive = !currentActive;
    setTogglingId(id);
    setAutomations((prev) =>
      prev.map((a) => (a.id === id ? { ...a, active: nextActive } : a))
    );

    try {
      const res = await toggleCampaignActive(id, nextActive);
      if (!res.success) {
        setAutomations((prev) =>
          prev.map((a) => (a.id === id ? { ...a, active: currentActive } : a))
        );
        showToast(`Failed to update automation: ${res.error || "Unknown error"}`);
      } else {
        posthog.capture("campaign_status_changed", { active: nextActive });
        showToast(nextActive ? "Automation activated" : "Automation archived");
      }
    } catch {
      setAutomations((prev) =>
        prev.map((a) => (a.id === id ? { ...a, active: currentActive } : a))
      );
      showToast("Error updating automation status");
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
        showToast(`Could not delete automation: ${res.error}`);
      }
    } catch {
      showToast("Error deleting automation");
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredAutomations = automations.filter((auto) => {
    const matchesTab =
      activeTab === "all" ? true : activeTab === "active" ? auto.active : !auto.active;
    const q = searchQuery.toLowerCase();
    const matchesQuery =
      !q ||
      auto.name.toLowerCase().includes(q) ||
      auto.dmMessage.toLowerCase().includes(q) ||
      (auto.triggerKeywords || []).some((k) => k.toLowerCase().includes(q));
    return matchesTab && matchesQuery;
  });

  return (
    <div className="zorcha-ui -m-4 min-h-[calc(100dvh-3.5rem)] bg-[#EBEBEB] p-4 sm:-m-6 sm:p-6 lg:-m-8 lg:p-8">
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-3 duration-200">
          <div className="flex items-center gap-2 rounded-full bg-[var(--z-black-dark)] px-4 py-2.5 text-xs font-medium text-white shadow-lg">
            <Check className="size-3.5 text-[var(--z-positive)]" aria-hidden="true" />
            <span>{toastMessage}</span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight text-[var(--z-black)]">
            Automations
          </h1>
          <p className="mt-1 text-sm text-[var(--z-black-light)]">
            Automate conversations and watch your DMs do the work for you.
          </p>
        </div>
        <Button
          asChild
          variant="outline"
          size="sm"
          className="h-8 w-fit rounded-[11px] border-[var(--z-line-dark)] bg-[var(--z-bg-light)] px-3 text-xs font-semibold text-[var(--z-black)]"
        >
          <Link href="/support">Support</Link>
        </Button>
      </div>

      {(created || saved) && (
        <div
          role="status"
          className="mt-4 flex items-center gap-2 rounded-[11px] border border-[var(--z-positive)]/40 bg-[var(--z-positive)]/10 px-3 py-2 text-xs font-semibold text-[var(--z-positive)]"
        >
          <Check className="size-4 shrink-0" aria-hidden="true" />
          {created
            ? "Automation published. Comment your keyword from another account to test it."
            : "Automation changes saved."}
        </div>
      )}

      {/* Controls */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 items-center overflow-hidden rounded-[11px] border border-[var(--z-line-dark)] bg-[var(--z-bg-light)]">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  aria-pressed={isActive}
                  className={`flex h-full items-center gap-1.5 px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--z-primary)] ${
                    isActive
                      ? "bg-[var(--z-line)]/60 text-[var(--z-black)]"
                      : "text-[var(--z-black-light)] hover:bg-[var(--z-line)]/40"
                  }`}
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="flex h-8 items-center rounded-[11px] border border-[var(--z-line-dark)] bg-white px-2">
            <span className="text-sm font-semibold tabular-nums text-[#06121D]">
              {automations.length}
            </span>
            <span className="px-1 text-sm font-semibold tabular-nums text-[#B2B2B2]">/</span>
            <span className="text-sm font-semibold capitalize tabular-nums text-[#B2B2B2]">
              Unlimited
            </span>
          </div>
        </div>

        <div className="relative w-full sm:ml-auto sm:w-[220px]">
          <Search
            className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--z-black-light)]"
            aria-hidden="true"
          />
          <Input
            placeholder="Search automations"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search automations by name"
            className="h-8 rounded-[12px] border-[var(--z-line-dark)] bg-[var(--z-bg-light)] pl-8 text-sm font-medium text-[var(--z-black)] placeholder:text-[#9CA3AF] focus-visible:border-[var(--z-line-dark)] focus-visible:ring-1 focus-visible:ring-[var(--z-primary)]"
          />
        </div>

        <button
          type="button"
          onClick={() => setTemplatesOpen(true)}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-[11px] bg-[var(--z-primary)] px-3 text-xs font-semibold text-white transition-colors hover:bg-[var(--z-primary)]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--z-primary)] focus-visible:ring-offset-2"
        >
          <Plus className="size-4" aria-hidden="true" />
          New Automation
        </button>
      </div>

      {/* List / empty state */}
      <div className="mt-5">
        {filteredAutomations.length > 0 ? (
          <div className="grid gap-3">
            {filteredAutomations.map((auto) => (
              <div
                key={auto.id}
                className="rounded-[14px] border border-[var(--z-line)] bg-[var(--z-bg-light)] p-4 transition-colors hover:bg-[var(--z-line)]/20"
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    {auto.postThumbnailUrl && (
                      <div className="relative size-12 shrink-0 overflow-hidden rounded-xl border border-[var(--z-line)]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={auto.postThumbnailUrl}
                          alt={auto.name}
                          className="h-full w-full object-cover"
                        />
                      </div>
                    )}
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold text-[var(--z-black)]">
                          {auto.name}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            auto.active
                              ? "bg-[var(--z-positive)]/10 text-[var(--z-positive)]"
                              : "bg-[var(--z-line)] text-[var(--z-black-light)]"
                          }`}
                        >
                          {auto.active ? "Active" : "Archived"}
                        </span>
                        {auto.followGateEnabled && (
                          <span className="flex items-center gap-1 rounded-full border border-[var(--z-positive)]/40 px-2 py-0.5 text-[10px] font-medium text-[var(--z-positive)]">
                            <ShieldCheck className="size-2.5" aria-hidden="true" />
                            Follow-gated
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--z-black-light)]">
                        <span className="font-medium text-[var(--z-black)]">Keywords:</span>
                        {(auto.triggerKeywords || []).map((kw, i) => (
                          <span
                            key={i}
                            className="rounded-full bg-[var(--z-black-dark)] px-2 py-0.5 font-mono text-[11px] font-medium text-white"
                          >
                            {kw}
                          </span>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 rounded-xl border border-[var(--z-line)] bg-[var(--z-line)]/30 px-3 py-2 text-xs text-[var(--z-black)]">
                        <MessageCircle className="size-3.5 shrink-0 text-[var(--z-positive)]" aria-hidden="true" />
                        <span className="line-clamp-2">&ldquo;{auto.dmMessage}&rdquo;</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--z-line)] pt-3 md:border-t-0 md:pt-0">
                    <div className="text-left md:text-right">
                      <p className="text-[10px] font-semibold uppercase text-[var(--z-black-light)]">
                        Dispatched
                      </p>
                      <p className="text-base font-bold text-[var(--z-black)]">
                        {logCountsByAutoId[auto.id] || 0} DMs
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={auto.active}
                        disabled={togglingId === auto.id}
                        onCheckedChange={() => handleToggle(auto.id, auto.active)}
                        aria-label={`Toggle ${auto.name}`}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        asChild
                        className="h-8 rounded-[11px] border-[var(--z-line-dark)] px-2.5 text-[11px] font-semibold"
                      >
                        <Link href={`/dashboard/campaigns/${auto.id}/edit`}>
                          <Pencil className="size-3.5" aria-hidden="true" />
                          <span className="hidden lg:inline">Edit</span>
                        </Link>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setRerunTarget(auto);
                          setRerunOpen(true);
                        }}
                        className="h-8 rounded-[11px] border-[var(--z-line-dark)] px-2.5 text-[11px] font-semibold"
                      >
                        <RotateCcw className="size-3.5" aria-hidden="true" />
                        <span className="hidden lg:inline">Re-run</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteTarget(auto)}
                        className="size-8 rounded-full text-[var(--z-black-light)] hover:bg-[var(--z-negative)]/10 hover:text-[var(--z-negative)]"
                        aria-label={`Delete ${auto.name}`}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-[14px] border border-[var(--z-line)] bg-[var(--z-bg-light)] px-6 py-16 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[var(--z-line)] text-[var(--z-black-light)]">
              <Megaphone className="size-5" aria-hidden="true" />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-[var(--z-black)]">
              {searchQuery ? "No matching automations" : "Launch your first automation"}
            </h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-[var(--z-black-light)]">
              {searchQuery
                ? `No automations matched "${searchQuery}". Try a different keyword.`
                : "Automate conversations and watch your DMs do the work for you."}
            </p>
            {!searchQuery && (
              <button
                type="button"
                onClick={() => setTemplatesOpen(true)}
                className="mt-5 inline-flex h-9 items-center gap-1.5 rounded-[11px] bg-[var(--z-primary)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--z-primary)]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--z-primary)] focus-visible:ring-offset-2"
              >
                <Plus className="size-4" aria-hidden="true" />
                Start Automating
              </button>
            )}
          </div>
        )}
      </div>

      <TemplatesDialog open={templatesOpen} onOpenChange={setTemplatesOpen} />

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="zorcha-ui !bg-[var(--z-bg-light)] !border-[var(--z-line)] rounded-3xl p-6 sm:max-w-md">
          <DialogHeader className="space-y-2">
            <div className="flex size-10 items-center justify-center rounded-2xl bg-[var(--z-negative)]/10 text-[var(--z-negative)]">
              <AlertTriangle className="size-5" aria-hidden="true" />
            </div>
            <DialogTitle className="text-lg font-bold text-[var(--z-black)]">
              Delete automation?
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed text-[var(--z-black-light)]">
              Are you sure you want to delete{" "}
              <span className="font-semibold text-[var(--z-black)]">
                &ldquo;{deleteTarget?.name}&rdquo;
              </span>
              ? This permanently stops its triggers.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 pt-3 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={isDeleting}
              onClick={() => setDeleteTarget(null)}
              className="h-9 rounded-full text-xs font-semibold"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={isDeleting}
              onClick={handleDelete}
              className="h-9 rounded-full bg-[var(--z-negative)] text-xs font-semibold text-white hover:bg-[var(--z-negative)]/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
                  Deleting…
                </>
              ) : (
                "Delete automation"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RerunDialog
        campaign={rerunTarget}
        open={rerunOpen}
        onOpenChange={(next) => {
          setRerunOpen(next);
          if (!next) setRerunTarget(null);
        }}
        onCompleted={({ sent, skipped, failed }) => {
          showToast(`Re-run finished: ${sent} sent, ${skipped} skipped, ${failed} failed`);
          router.refresh();
        }}
      />
    </div>
  );
}
