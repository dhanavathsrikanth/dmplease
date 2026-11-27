"use client";

import { useState } from "react";
import Link from "next/link";
import posthog from "posthog-js";
import {
  ArrowLeft,
  Check,
  Heart,
  Loader2,
  MessageCircle,
  Pencil,
  Plus,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { FollowGateSettings } from "@/components/campaigns/follow-gate-settings";
import type {
  DmRuleItem,
  DmRuleTrigger,
  WorkspaceOption,
} from "@/components/inbox-rules/rule-manager";
import {
  createRule,
  deleteRule,
  toggleRule,
  updateRule,
} from "@/app/dashboard/inbox-automations/actions";
import {
  FOLLOW_GATE_DEFAULTS,
  type FollowGateUnavailablePolicy,
} from "@/lib/follow-gate-constants";

const STORY_TRIGGERS: DmRuleTrigger[] = [
  "STORY_REPLY",
  "STORY_MENTION",
  "STORY_REACTION",
  "MESSAGE_REACTION",
];

const TRIGGER_LABELS: Record<DmRuleTrigger, string> = {
  DM_KEYWORD: "Inbox keyword",
  STORY_REPLY: "Story reply",
  STORY_MENTION: "Story mention",
  STORY_REACTION: "Story reaction",
  SHARE_TO_DM: "Share to DM",
  MESSAGE_REACTION: "Reaction to your DM",
};

const TRIGGER_HINTS: Record<DmRuleTrigger, string> = {
  DM_KEYWORD: "When a follower messages you a keyword",
  STORY_REPLY: "When someone answers one of your stories",
  STORY_MENTION: "When someone tags your account in their story",
  STORY_REACTION: "When someone reacts to one of your stories with an emoji",
  SHARE_TO_DM: "When a follower shares your post to your DMs",
  MESSAGE_REACTION:
    "When a follower reacts to a DM you sent (Meta has no per-user story-tap reaction)",
};

const selectClass =
  "flex h-9 w-full rounded-full border border-[#c7cad5] dark:border-border bg-background px-3.5 text-xs text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

type CollectField = "none" | "email" | "phone" | "name" | "custom";

interface StoryFormState {
  id: string | null;
  workspaceId: string;
  name: string;
  triggerType: DmRuleTrigger;
  keywords: string;
  message: string;
  buttonText: string;
  buttonUrl: string;
  collectField: CollectField;
  oncePerDays: number;
  active: boolean;
  followGateEnabled: boolean;
  openingMessage: string;
  followGateButtonLabel: string;
  followGateOnUnavailable: FollowGateUnavailablePolicy;
}

function emptyForm(workspaceId: string): StoryFormState {
  return {
    id: null,
    workspaceId,
    name: "Story auto-DM",
    triggerType: "STORY_REPLY",
    keywords: "",
    message:
      "Thanks for watching the story {username}! Here's what I promised: {link}",
    buttonText: "Get it",
    buttonUrl: "",
    collectField: "none",
    oncePerDays: 45,
    active: true,
    followGateEnabled: true,
    openingMessage: FOLLOW_GATE_DEFAULTS.openingMessage,
    followGateButtonLabel: FOLLOW_GATE_DEFAULTS.buttonLabel,
    followGateOnUnavailable: "hold",
  };
}

function fromRule(rule: DmRuleItem): StoryFormState {
  return {
    id: rule.id,
    workspaceId: rule.workspaceId,
    name: rule.name,
    triggerType: STORY_TRIGGERS.includes(rule.triggerType)
      ? rule.triggerType
      : "STORY_REPLY",
    keywords: rule.keywords.join(", "),
    message: rule.message,
    buttonText: rule.buttonText || "",
    buttonUrl: rule.buttonUrl || "",
    collectField:
      rule.collectField === "email" ||
      rule.collectField === "phone" ||
      rule.collectField === "name" ||
      rule.collectField === "custom"
        ? rule.collectField
        : "none",
    oncePerDays: rule.oncePerDays,
    active: rule.active,
    followGateEnabled: rule.followGateEnabled,
    openingMessage: rule.openingMessage || FOLLOW_GATE_DEFAULTS.openingMessage,
    followGateButtonLabel:
      rule.followGateButtonLabel || FOLLOW_GATE_DEFAULTS.buttonLabel,
    followGateOnUnavailable: rule.followGateOnUnavailable,
  };
}

/** Dedicated Story-to-DM builder: story/reaction triggers + full follow gate. */
export function StoryAutomationBuilder({
  initialRules,
  workspaces,
}: {
  initialRules: DmRuleItem[];
  workspaces: WorkspaceOption[];
}) {
  const [rules, setRules] = useState<DmRuleItem[]>(initialRules);
  const [form, setForm] = useState<StoryFormState>(
    emptyForm(workspaces[0]?.id || "")
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const update = <K extends keyof StoryFormState>(key: K, value: StoryFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 3000);
  };

  const handleSave = async () => {
    if (!form.workspaceId) {
      setError("Select a workspace first.");
      return;
    }
    setBusy(true);
    setError(null);
    const payload = {
      id: form.id || undefined,
      workspaceId: form.workspaceId,
      name: form.name || "Story auto-DM",
      triggerType: form.triggerType,
      keywords: form.keywords
        .split(",")
        .map((keyword) => keyword.trim())
        .filter(Boolean),
      message: form.message,
      buttonText: form.buttonText,
      buttonUrl: form.buttonUrl,
      collectField: form.collectField,
      followGateEnabled: form.followGateEnabled,
      openingMessage: form.followGateEnabled ? form.openingMessage : "",
      followGateButtonLabel: form.followGateEnabled
        ? form.followGateButtonLabel
        : "",
      followGateOnUnavailable: form.followGateOnUnavailable,
      oncePerDays: form.oncePerDays,
      active: form.active,
    };

    try {
      const result = form.id ? await updateRule(payload) : await createRule(payload);
      if (!result.success) {
        setError(result.error || "Could not save the automation.");
        return;
      }
      const saved: DmRuleItem = {
        id: result.id || form.id || `local-${Date.now()}`,
        workspaceId: form.workspaceId,
        name: form.name.trim(),
        triggerType: form.triggerType,
        keywords: payload.keywords.map((k) => k.toUpperCase()),
        message: form.message.trim(),
        buttonText: form.buttonText.trim() || null,
        buttonUrl: form.buttonUrl.trim() || null,
        collectField: form.collectField === "none" ? null : form.collectField,
        followGateEnabled: form.followGateEnabled,
        openingMessage: form.followGateEnabled ? form.openingMessage : null,
        followGateButtonLabel: form.followGateEnabled
          ? form.followGateButtonLabel
          : null,
        followGateOnUnavailable: form.followGateOnUnavailable,
        oncePerDays: form.oncePerDays,
        priority: 0,
        active: form.active,
        createdAt:
          rules.find((rule) => rule.id === form.id)?.createdAt ||
          new Date().toISOString(),
      };
      setRules((prev) =>
        form.id
          ? prev.map((rule) => (rule.id === form.id ? saved : rule))
          : [saved, ...prev]
      );
      posthog.capture(form.id ? "story_automation_updated" : "story_automation_created", {
        trigger_type: form.triggerType,
        follow_gate_enabled: form.followGateEnabled,
      });
      setForm(emptyForm(form.workspaceId));
      flash(form.id ? "Story automation updated" : "Story automation created");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (rule: DmRuleItem) => {
    setTogglingId(rule.id);
    const next = !rule.active;
    setRules((prev) =>
      prev.map((item) => (item.id === rule.id ? { ...item, active: next } : item))
    );
    try {
      const result = await toggleRule(rule.id, next);
      if (!result.success) {
        setRules((prev) =>
          prev.map((item) => (item.id === rule.id ? { ...item, active: rule.active } : item))
        );
        setError(result.error || "Could not change the status.");
      } else {
        flash(next ? "Automation activated" : "Automation paused");
      }
    } catch {
      setRules((prev) =>
        prev.map((item) => (item.id === rule.id ? { ...item, active: rule.active } : item))
      );
      setError("Network error. Please try again.");
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (rule: DmRuleItem) => {
    setBusy(true);
    try {
      const result = await deleteRule(rule.id);
      if (result.success) {
        setRules((prev) => prev.filter((item) => item.id !== rule.id));
        if (form.id === rule.id) setForm(emptyForm(workspaces[0]?.id || ""));
        flash("Automation deleted");
      } else {
        setError(result.error || "Could not delete the automation.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {(notice || error) && (
        <div
          role="status"
          className={`rounded-full px-4 py-2 text-xs font-medium w-fit ${
            error
              ? "bg-rose-600 text-white"
              : "bg-[#1c1c1e] text-white dark:bg-white dark:text-[#1c1c1e]"
          }`}
        >
          {error || notice}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 space-y-4">
          <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 p-5 shadow-subtle space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-sm text-foreground flex items-center gap-2">
                  <Sparkles className="size-4 text-[#ff6b8a]" aria-hidden="true" />
                  {form.id ? "Edit story automation" : "New story automation"}
                </h2>
                <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground mt-0.5">
                  Reply when someone engages with a story or reacts to your DM.
                </p>
              </div>
              <Button asChild variant="ghost" size="icon" className="size-8 rounded-full">
                <Link href="/dashboard/inbox-automations">
                  <ArrowLeft className="size-4" />
                </Link>
              </Button>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="story-name">Name</Label>
                <Input
                  id="story-name"
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                  className="h-9 rounded-full text-xs"
                  disabled={busy}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="story-workspace">Workspace</Label>
                <select
                  id="story-workspace"
                  className={selectClass}
                  value={form.workspaceId}
                  disabled={busy || Boolean(form.id)}
                  onChange={(e) => update("workspaceId", e.target.value)}
                >
                  {workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="story-trigger">Trigger</Label>
                <select
                  id="story-trigger"
                  className={selectClass}
                  value={form.triggerType}
                  disabled={busy}
                  onChange={(e) =>
                    update("triggerType", e.target.value as DmRuleTrigger)
                  }
                >
                  {STORY_TRIGGERS.map((trigger) => (
                    <option key={trigger} value={trigger}>
                      {TRIGGER_LABELS[trigger]}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-[#6b6f7e]">
                  {TRIGGER_HINTS[form.triggerType]}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="story-keywords">Keywords / reactions</Label>
                <Input
                  id="story-keywords"
                  value={form.keywords}
                  onChange={(e) => update("keywords", e.target.value)}
                  placeholder={
                    form.triggerType === "MESSAGE_REACTION"
                      ? "🔥, love"
                      : "GUIDE, LINK"
                  }
                  className="h-9 rounded-full text-xs"
                  disabled={busy}
                />
                <p className="text-[10px] text-[#6b6f7e]">
                  Leave blank to respond to every {TRIGGER_LABELS[form.triggerType].toLowerCase()}.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="story-message">Reply message</Label>
              <textarea
                id="story-message"
                rows={4}
                value={form.message}
                onChange={(e) => update("message", e.target.value)}
                disabled={busy}
                className="flex w-full rounded-2xl border border-[#c7cad5] dark:border-border bg-background px-3.5 py-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                placeholder="Thanks for watching! Here's your link: {link}"
              />
              <p className="text-[10px] text-[#6b6f7e]">
                Supports {"{username}"}, {"{keyword}"} and {"{link}"}.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="story-button">Button label (optional)</Label>
                <Input
                  id="story-button"
                  value={form.buttonText}
                  onChange={(e) => update("buttonText", e.target.value)}
                  className="h-9 rounded-full text-xs"
                  disabled={busy}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="story-url">Button URL (optional)</Label>
                <Input
                  id="story-url"
                  value={form.buttonUrl}
                  onChange={(e) => update("buttonUrl", e.target.value)}
                  placeholder="https://example.com/offer"
                  className="h-9 rounded-full text-xs"
                  disabled={busy}
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="story-collect">Collect info</Label>
                <select
                  id="story-collect"
                  className={selectClass}
                  value={form.collectField}
                  disabled={busy}
                  onChange={(e) =>
                    update("collectField", e.target.value as CollectField)
                  }
                >
                  <option value="none">None</option>
                  <option value="email">Email</option>
                  <option value="phone">Phone</option>
                  <option value="name">Name</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="story-once">Run at most once per (days)</Label>
                <Input
                  id="story-once"
                  type="number"
                  min={0}
                  max={365}
                  value={form.oncePerDays}
                  onChange={(e) => update("oncePerDays", Number(e.target.value))}
                  className="h-9 rounded-full text-xs"
                  disabled={busy}
                />
              </div>
            </div>

            <FollowGateSettings
              mode="direct"
              enabled={form.followGateEnabled}
              onEnabledChange={(value) => update("followGateEnabled", value)}
              openingMessage={form.openingMessage}
              onOpeningMessageChange={(value) => update("openingMessage", value)}
              buttonLabel={form.followGateButtonLabel}
              onButtonLabelChange={(value) =>
                update("followGateButtonLabel", value)
              }
              onUnavailable={form.followGateOnUnavailable}
              onUnavailableChange={(value) =>
                update("followGateOnUnavailable", value)
              }
              disabled={busy}
            />

            <div className="flex items-center justify-between rounded-2xl border border-[#e0e2e8] dark:border-border/60 bg-[#f7f8fa] dark:bg-muted/40 px-4 py-3">
              <div>
                <Label htmlFor="story-active" className="cursor-pointer">
                  Automation active
                </Label>
                <p className="text-[10px] text-[#6b6f7e] mt-1">
                  Paused automations stay saved but never reply.
                </p>
              </div>
              <Switch
                id="story-active"
                checked={form.active}
                disabled={busy}
                onCheckedChange={(checked) => update("active", checked)}
              />
            </div>

            <div className="flex gap-2">
              <Button
                onClick={handleSave}
                disabled={busy || workspaces.length === 0}
                className="rounded-full text-xs font-semibold h-9 bg-[#1c1c1e] text-white dark:bg-[#ffd02f] dark:text-[#1c1c1e]"
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Check className="size-3.5" />
                )}
                {form.id ? "Save changes" : "Create automation"}
              </Button>
              {form.id && (
                <Button
                  variant="outline"
                  onClick={() => setForm(emptyForm(workspaces[0]?.id || ""))}
                  className="rounded-full text-xs font-semibold h-9"
                >
                  Cancel edit
                </Button>
              )}
            </div>
          </Card>
        </div>

        <div className="lg:col-span-5">
          <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 p-5 shadow-subtle sticky top-20 space-y-4">
            <h3 className="font-semibold text-sm text-foreground">Preview</h3>
            <div className="mx-auto max-w-[280px] rounded-[28px] border-8 border-[#1c1c1e] dark:border-[#363636] bg-white dark:bg-[#111] overflow-hidden shadow-lg">
              <div className="aspect-[9/13] bg-gradient-to-br from-[#515bd4] via-[#d62976] to-[#f58529] p-3 flex flex-col justify-between">
                <p className="text-[10px] font-semibold text-white/90 drop-shadow">
                  your.story
                </p>
                <div className="self-center rounded-2xl bg-black/35 px-3 py-2 text-[11px] text-white backdrop-blur-sm">
                  {TRIGGER_LABELS[form.triggerType]}
                </div>
                <div className="flex items-center justify-between text-white/90 text-[11px]">
                  <MessageCircle className="size-4" />
                  <Heart className="size-4" />
                  <Send className="size-4" />
                </div>
              </div>
              <div className="p-3 space-y-2 bg-[#fafafa] dark:bg-[#161616]">
                <p className="text-[10px] text-[#6b6f7e]">Follower&apos;s DM</p>
                <div className="rounded-2xl bg-[#efefef] dark:bg-[#262626] px-3 py-2 text-[11px] text-foreground max-w-[200px]">
                  {form.triggerType === "MESSAGE_REACTION"
                    ? form.keywords.split(",")[0]?.trim() || "🔥"
                    : form.keywords.split(",")[0]?.trim() || "GUIDE"}
                </div>
                {form.followGateEnabled && (
                  <div className="rounded-2xl bg-gradient-to-br from-[#515bd4] via-[#d62976] to-[#f58529] px-3 py-2 text-[11px] text-white max-w-[220px] ml-auto">
                    <p className="whitespace-pre-wrap">
                      {form.openingMessage
                        .replace(/\{username\}/gi, "there")
                        .replace(/\{keyword\}/gi, "GUIDE")}
                    </p>
                    <div className="mt-2 rounded-full bg-white/95 px-2 py-1 text-center text-[10px] font-semibold text-[#262626]">
                      {form.followGateButtonLabel || "I'm following ✅"}
                    </div>
                  </div>
                )}
                <div className="rounded-2xl bg-[#1c1c1e] dark:bg-white px-3 py-2 text-[11px] text-white dark:text-[#1c1c1e] max-w-[220px] ml-auto whitespace-pre-wrap">
                  {form.message
                    .replace(/\{username\}/gi, "there")
                    .replace(/\{keyword\}/gi, "GUIDE")
                    .replace(/\{link\}/gi, form.buttonUrl || "https://your-link.com")}
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 p-5 shadow-subtle space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm text-foreground">
            Story automations ({rules.length})
          </h3>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setForm(emptyForm(workspaces[0]?.id || ""))}
            className="rounded-full text-xs h-9"
          >
            <Plus className="size-3.5" /> New
          </Button>
        </div>
        {rules.length === 0 ? (
          <p className="text-xs text-[#555a6a] dark:text-muted-foreground rounded-xl bg-[#f7f8fa] dark:bg-muted/30 px-4 py-6 text-center">
            No story automations yet. Create one above to reply to story engagements.
          </p>
        ) : (
          <div className="grid gap-2.5">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-xs text-foreground truncate">
                      {rule.name}
                    </span>
                    <Badge variant="outline" className="text-[10px] rounded-full">
                      {TRIGGER_LABELS[rule.triggerType] || rule.triggerType}
                    </Badge>
                    {rule.followGateEnabled && (
                      <Badge variant="tag-teal" className="text-[10px] rounded-full">
                        Follow gate
                      </Badge>
                    )}
                    <Badge
                      variant={rule.active ? "tag-teal" : "secondary"}
                      className="text-[10px] rounded-full"
                    >
                      {rule.active ? "Active" : "Paused"}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground line-clamp-1">
                    {rule.message}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Switch
                    checked={rule.active}
                    disabled={togglingId === rule.id}
                    onCheckedChange={() => handleToggle(rule)}
                    aria-label={`Toggle ${rule.name}`}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setForm(fromRule(rule));
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    className="size-8 rounded-full"
                    title="Edit"
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(rule)}
                    disabled={busy}
                    className="size-8 rounded-full text-muted-foreground hover:text-rose-600"
                    title="Delete"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
