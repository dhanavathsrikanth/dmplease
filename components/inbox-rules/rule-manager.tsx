"use client";

import { useState } from "react";
import {
  AlertCircle,
  Check,
  Loader2,
  MessageSquareText,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createRule,
  deleteRule,
  toggleRule,
  updateRule,
} from "@/app/dashboard/inbox-automations/actions";

export type DmRuleTrigger =
  | "DM_KEYWORD"
  | "STORY_REPLY"
  | "STORY_MENTION"
  | "SHARE_TO_DM";

export type DmRuleCollectField = "none" | "email" | "phone" | "name" | "custom";

export interface DmRuleItem {
  id: string;
  workspaceId: string;
  name: string;
  triggerType: DmRuleTrigger;
  keywords: string[];
  message: string;
  buttonText: string | null;
  buttonUrl: string | null;
  collectField: string | null;
  oncePerDays: number;
  priority: number;
  active: boolean;
  createdAt: string;
}

export interface WorkspaceOption {
  id: string;
  name: string;
}

interface RuleFormState {
  id: string | null;
  workspaceId: string;
  name: string;
  triggerType: DmRuleTrigger;
  keywords: string;
  message: string;
  buttonText: string;
  buttonUrl: string;
  collectField: DmRuleCollectField;
  oncePerDays: number;
  active: boolean;
}

const TRIGGER_LABELS: Record<DmRuleTrigger, string> = {
  DM_KEYWORD: "Inbox keyword",
  STORY_REPLY: "Story reply",
  STORY_MENTION: "Story mention",
  SHARE_TO_DM: "Share to DM",
};

const TRIGGER_HINTS: Record<DmRuleTrigger, string> = {
  DM_KEYWORD: "When a follower messages you a keyword",
  STORY_REPLY: "When a follower replies to one of your stories",
  STORY_MENTION: "When a follower mentions you in their story",
  SHARE_TO_DM: "When a follower shares your post to your DMs",
};

const selectClass =
  "flex h-9 w-full rounded-full border border-[#c7cad5] dark:border-border bg-background px-3.5 text-xs text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50";

function emptyForm(workspaceId: string): RuleFormState {
  return {
    id: null,
    workspaceId,
    name: "",
    triggerType: "DM_KEYWORD",
    keywords: "",
    message: "",
    buttonText: "",
    buttonUrl: "",
    collectField: "none",
    oncePerDays: 45,
    active: true,
  };
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
      {message}
    </p>
  );
}

export function RuleManager({
  initialRules,
  workspaces,
}: {
  initialRules: DmRuleItem[];
  workspaces: WorkspaceOption[];
}) {
  const [rules, setRules] = useState<DmRuleItem[]>(initialRules);
  const [form, setForm] = useState<RuleFormState>(emptyForm(workspaces[0]?.id || ""));
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DmRuleItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeIsError, setNoticeIsError] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const flash = (message: string, isError = false) => {
    setNotice(message);
    setNoticeIsError(isError);
    window.setTimeout(() => setNotice(null), 3000);
  };

  const openCreate = () => {
    setForm(emptyForm(workspaces[0]?.id || ""));
    setFormError(null);
    setFieldErrors({});
    setIsFormOpen(true);
  };

  const openEdit = (rule: DmRuleItem) => {
    setForm({
      id: rule.id,
      workspaceId: rule.workspaceId,
      name: rule.name,
      triggerType: rule.triggerType,
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
    });
    setFormError(null);
    setFieldErrors({});
    setIsFormOpen(true);
  };

  const saveRule = async () => {
    setBusy(true);
    setFormError(null);
    setFieldErrors({});

    const payload = {
      id: form.id || undefined,
      workspaceId: form.workspaceId,
      name: form.name,
      triggerType: form.triggerType,
      keywords: form.keywords
        .split(",")
        .map((keyword) => keyword.trim())
        .filter(Boolean),
      message: form.message,
      buttonText: form.buttonText,
      buttonUrl: form.buttonUrl,
      collectField: form.collectField,
      oncePerDays: form.oncePerDays,
      active: form.active,
    };

    try {
      const result = form.id ? await updateRule(payload) : await createRule(payload);
      if (!result.success) {
        setFormError(result.error || "Could not save the rule.");
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
        return;
      }

      const saved: DmRuleItem = {
        id: result.id || form.id || `local-${Date.now()}`,
        workspaceId: form.workspaceId,
        name: form.name.trim(),
        triggerType: form.triggerType,
        keywords: payload.keywords.map((keyword) => keyword.toUpperCase()),
        message: form.message.trim(),
        buttonText: form.buttonText.trim() || null,
        buttonUrl: form.buttonUrl.trim() || null,
        collectField: form.collectField === "none" ? null : form.collectField,
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
      setIsFormOpen(false);
      flash(form.id ? "Rule updated" : "Rule created");
    } catch {
      setFormError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      const result = await deleteRule(deleteTarget.id);
      if (result.success) {
        setRules((prev) => prev.filter((rule) => rule.id !== deleteTarget.id));
        setDeleteTarget(null);
        flash("Rule deleted");
      } else {
        flash(result.error || "Could not delete the rule.", true);
      }
    } catch {
      flash("Network error. Please try again.", true);
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (rule: DmRuleItem) => {
    setTogglingId(rule.id);
    const nextActive = !rule.active;
    setRules((prev) =>
      prev.map((item) =>
        item.id === rule.id ? { ...item, active: nextActive } : item
      )
    );
    try {
      const result = await toggleRule(rule.id, nextActive);
      if (!result.success) {
        setRules((prev) =>
          prev.map((item) =>
            item.id === rule.id ? { ...item, active: rule.active } : item
          )
        );
        flash(result.error || "Could not change the rule status.", true);
      } else {
        flash(nextActive ? "Rule activated" : "Rule paused");
      }
    } catch {
      setRules((prev) =>
        prev.map((item) =>
          item.id === rule.id ? { ...item, active: rule.active } : item
        )
      );
      flash("Network error. Please try again.", true);
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {notice && (
        <div
          role="status"
          aria-live="polite"
          className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium ${
            noticeIsError
              ? "bg-rose-600 text-white dark:bg-rose-500"
              : "bg-[#1c1c1e] text-white dark:bg-white dark:text-[#1c1c1e]"
          }`}
        >
          {noticeIsError ? (
            <AlertCircle className="size-3.5" />
          ) : (
            <Check className="size-3.5 text-[#00b473] dark:text-[#008a5c]" />
          )}
          {notice}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Your rules</h2>
          <p className="text-xs text-[#555a6a] dark:text-muted-foreground mt-0.5">
            {rules.length === 0
              ? "No automations configured yet."
              : `${rules.length} automation${rules.length === 1 ? "" : "s"} configured.`}
          </p>
        </div>
        <Button
          onClick={openCreate}
          disabled={workspaces.length === 0}
          size="sm"
          className="rounded-full h-9 px-5 text-xs font-semibold bg-[#1c1c1e] text-white dark:bg-[#ffd02f] dark:text-[#1c1c1e]"
        >
          <Plus className="size-3.5" />
          New rule
        </Button>
      </div>

      {workspaces.length === 0 && (
        <Card className="rounded-2xl border border-dashed border-[#e0e2e8] dark:border-border/80 p-5 text-xs text-[#555a6a] dark:text-muted-foreground">
          Create a workspace before adding inbox automations.
        </Card>
      )}

      {rules.length > 0 ? (
        <div className="grid gap-3.5">
          {rules.map((rule) => (
            <Card
              key={rule.id}
              className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle p-5"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-2.5 flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-foreground truncate">
                      {rule.name}
                    </span>
                    <Badge
                      variant={rule.active ? "tag-teal" : "secondary"}
                      className="text-[10px] font-semibold py-0.5 px-2.5 rounded-full"
                    >
                      {rule.active ? "Active" : "Paused"}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="text-[10px] font-medium rounded-full px-2.5"
                    >
                      {TRIGGER_LABELS[rule.triggerType] || rule.triggerType}
                    </Badge>
                  </div>
                  <p className="text-xs text-[#555a6a] dark:text-muted-foreground">
                    {TRIGGER_HINTS[rule.triggerType] || "Triggered by a follower interaction."}
                  </p>
                  {rule.keywords.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {rule.keywords.map((keyword) => (
                        <Badge
                          key={keyword}
                          variant="night"
                          className="text-[10px] px-2 py-0.5"
                        >
                          {keyword}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <div className="p-3 rounded-xl bg-[#f7f8fa] dark:bg-muted/40 border border-[#e0e2e8] dark:border-border/60 text-xs text-foreground font-sans">
                    <span className="line-clamp-2">&ldquo;{rule.message}&rdquo;</span>
                  </div>
                  <p className="text-[10px] text-[#6b6f7e]">
                    Runs at most once every {rule.oncePerDays} day
                    {rule.oncePerDays === 1 ? "" : "s"}
                    {rule.collectField ? ` · Collects ${rule.collectField}` : ""}
                  </p>
                </div>

                <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-3 shrink-0 border-t sm:border-t-0 pt-3 sm:pt-0 border-[#e0e2e8] dark:border-border/60">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-muted-foreground">
                      {rule.active ? "Active" : "Paused"}
                    </span>
                    <Switch
                      checked={rule.active}
                      disabled={togglingId === rule.id}
                      onCheckedChange={() => handleToggle(rule)}
                      aria-label={`Toggle ${rule.name}`}
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEdit(rule)}
                      className="size-8 rounded-full text-muted-foreground hover:text-foreground"
                      title="Edit rule"
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteTarget(rule)}
                      className="size-8 rounded-full text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                      title="Delete rule"
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
          <div className="size-11 rounded-2xl bg-[#fff8e0] text-[#746019] flex items-center justify-center mx-auto shadow-xs dark:bg-[#746019]/30 dark:text-[#ffd02f]">
            <MessageSquareText className="size-5" />
          </div>
          <div>
            <h3 className="font-semibold text-base text-foreground">No inbox rules yet</h3>
            <p className="text-xs text-[#555a6a] dark:text-muted-foreground max-w-md mx-auto mt-1">
              Create a rule to auto-reply when someone messages you a keyword, replies to a story, mentions you, or shares your post.
            </p>
          </div>
          <Button
            onClick={openCreate}
            disabled={workspaces.length === 0}
            size="sm"
            className="rounded-full font-semibold text-xs mt-2 px-6 h-9 bg-[#1c1c1e] text-white dark:bg-[#ffd02f] dark:text-[#1c1c1e]"
          >
            Create your first rule
          </Button>
        </Card>
      )}

      {/* Create / edit dialog */}
      <Dialog open={isFormOpen} onOpenChange={(open) => !open && setIsFormOpen(false)}>
        <DialogContent className="sm:max-w-xl rounded-3xl p-6 max-h-[90vh] overflow-y-auto">
          <DialogHeader className="space-y-2">
            <DialogTitle className="text-lg font-bold text-foreground">
              {form.id ? "Edit automation rule" : "New automation rule"}
            </DialogTitle>
            <DialogDescription className="text-xs text-[#555a6a] dark:text-muted-foreground">
              Choose a trigger, write the reply, and decide how often it can run per person.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 pt-2">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="rule-name">Rule name</Label>
                <Input
                  id="rule-name"
                  value={form.name}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, name: event.target.value }))
                  }
                  placeholder="e.g. PRICE reply"
                  className="rounded-full h-9 text-xs"
                  disabled={busy}
                />
                <FieldError message={fieldErrors.name} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rule-workspace">Workspace</Label>
                <select
                  id="rule-workspace"
                  className={selectClass}
                  value={form.workspaceId}
                  disabled={busy || Boolean(form.id)}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, workspaceId: event.target.value }))
                  }
                >
                  {workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))}
                </select>
                <FieldError message={fieldErrors.workspaceId} />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="rule-trigger">Trigger</Label>
                <select
                  id="rule-trigger"
                  className={selectClass}
                  value={form.triggerType}
                  disabled={busy}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      triggerType: event.target.value as DmRuleTrigger,
                    }))
                  }
                >
                  {(Object.keys(TRIGGER_LABELS) as DmRuleTrigger[]).map((trigger) => (
                    <option key={trigger} value={trigger}>
                      {TRIGGER_LABELS[trigger]}
                    </option>
                  ))}
                </select>
                <FieldError message={fieldErrors.triggerType} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rule-keywords">Keywords (comma separated)</Label>
                <Input
                  id="rule-keywords"
                  value={form.keywords}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, keywords: event.target.value }))
                  }
                  placeholder="PRICE, COST, GUIDE"
                  className="rounded-full h-9 text-xs"
                  disabled={busy}
                />
                <p className="text-[10px] text-[#6b6f7e]">
                  Leave blank to respond to all inbound messages for this trigger.
                </p>
                <FieldError message={fieldErrors.keywords} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rule-message">Reply message</Label>
              <textarea
                id="rule-message"
                value={form.message}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, message: event.target.value }))
                }
                rows={4}
                disabled={busy}
                placeholder="Thanks for reaching out! Here is the link you asked for..."
                className="flex w-full rounded-2xl border border-[#c7cad5] dark:border-border bg-background px-3.5 py-2.5 text-xs text-foreground placeholder:text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50"
              />
              <FieldError message={fieldErrors.message} />
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="rule-button-text">Button label (optional)</Label>
                <Input
                  id="rule-button-text"
                  value={form.buttonText}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, buttonText: event.target.value }))
                  }
                  placeholder="See the details"
                  className="rounded-full h-9 text-xs"
                  disabled={busy}
                />
                <FieldError message={fieldErrors.buttonText} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rule-button-url">Button URL (optional)</Label>
                <Input
                  id="rule-button-url"
                  value={form.buttonUrl}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, buttonUrl: event.target.value }))
                  }
                  placeholder="https://example.com/offer"
                  className="rounded-full h-9 text-xs"
                  disabled={busy}
                />
                <FieldError message={fieldErrors.buttonUrl} />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="rule-collect">Collect info</Label>
                <select
                  id="rule-collect"
                  className={selectClass}
                  value={form.collectField}
                  disabled={busy}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      collectField: event.target.value as DmRuleCollectField,
                    }))
                  }
                >
                  <option value="none">None</option>
                  <option value="email">Email</option>
                  <option value="phone">Phone</option>
                  <option value="name">Name</option>
                  <option value="custom">Custom property</option>
                </select>
                <FieldError message={fieldErrors.collectField} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rule-once">Run at most once per (days)</Label>
                <Input
                  id="rule-once"
                  type="number"
                  min={0}
                  max={365}
                  value={form.oncePerDays}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      oncePerDays: Number(event.target.value),
                    }))
                  }
                  className="rounded-full h-9 text-xs"
                  disabled={busy}
                />
                <FieldError message={fieldErrors.oncePerDays} />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-2xl border border-[#e0e2e8] dark:border-border/60 bg-[#f7f8fa] dark:bg-muted/40 px-4 py-3">
              <div>
                <Label htmlFor="rule-active" className="cursor-pointer">
                  Rule active
                </Label>
                <p className="text-[10px] text-[#6b6f7e] mt-1">
                  Paused rules stay saved but never reply.
                </p>
              </div>
              <Switch
                id="rule-active"
                checked={form.active}
                disabled={busy}
                onCheckedChange={(checked) =>
                  setForm((prev) => ({ ...prev, active: checked }))
                }
              />
            </div>

            {formError && (
              <div
                role="alert"
                aria-live="assertive"
                className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
              >
                <AlertCircle className="size-4 shrink-0" />
                {formError}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsFormOpen(false)}
              disabled={busy}
              className="rounded-full text-xs font-semibold h-9"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={saveRule}
              disabled={busy || workspaces.length === 0}
              className="rounded-full text-xs font-semibold h-9 bg-[#1c1c1e] text-white dark:bg-[#ffd02f] dark:text-[#1c1c1e]"
            >
              {busy ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Saving...
                </>
              ) : form.id ? (
                "Save changes"
              ) : (
                "Create rule"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent className="sm:max-w-md rounded-3xl p-6">
          <DialogHeader className="space-y-2">
            <div className="size-10 rounded-2xl bg-rose-50 text-rose-600 dark:bg-rose-950/40 flex items-center justify-center">
              <Trash2 className="size-5" />
            </div>
            <DialogTitle className="text-lg font-bold text-foreground">
              Delete this rule?
            </DialogTitle>
            <DialogDescription className="text-xs text-[#555a6a] dark:text-muted-foreground">
              &ldquo;{deleteTarget?.name}&rdquo; will stop replying immediately. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0 pt-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={busy}
              className="rounded-full text-xs font-semibold h-9"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmDelete}
              disabled={busy}
              className="rounded-full text-xs font-semibold h-9 bg-rose-600 hover:bg-rose-700 text-white"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : "Delete rule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
