"use client";

import { useId, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deletePostbackRoute,
  savePostbackRoute,
  type PostbackRouteView,
} from "@/app/dashboard/campaigns/postback-actions";

interface PostbackRouteEditorProps {
  workspaceId: string;
  routes: PostbackRouteView[];
}

export function PostbackRouteEditor({
  workspaceId,
  routes: initialRoutes,
}: PostbackRouteEditorProps) {
  const baseId = useId();
  const [routes, setRoutes] = useState<PostbackRouteView[]>(initialRoutes);
  const [editing, setEditing] = useState(false);
  const [payload, setPayload] = useState("");
  const [action, setAction] = useState<"tag" | "branch" | "followup">("tag");
  const [tagValue, setTagValue] = useState("");
  const [message, setMessage] = useState("");
  const [delayMinutes, setDelayMinutes] = useState(1440);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    const config: Record<string, unknown> =
      action === "tag"
        ? { tag: tagValue }
        : action === "branch"
          ? { message }
          : { message, delayMinutes, step: 1 };

    try {
      const result = await savePostbackRoute({
        workspaceId,
        payload,
        action,
        config,
        active: true,
      });
      if (!result.success) {
        setError(result.error ?? "Could not save the route.");
        return;
      }
      setRoutes((current) => [
        {
          id: `local-${Date.now()}`,
          payload,
          action,
          config,
          active: true,
          automationId: null,
        },
        ...current,
      ]);
      setEditing(false);
      setPayload("");
      setTagValue("");
      setMessage("");
    } catch {
      setError("Network error while saving.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await deletePostbackRoute(id, workspaceId);
      if (!result.success) {
        setError(result.error ?? "Could not delete the route.");
        return;
      }
      setRoutes((current) => current.filter((route) => route.id !== id));
    } catch {
      setError("Network error while deleting.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 p-5 shadow-subtle space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-sm text-foreground">Button actions</h3>
          <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground mt-0.5 max-w-lg">
            When someone taps a button in a DM, run an action automatically: tag the
            contact, send a follow-up message, or schedule a delayed follow-up.
            Button taps also refresh the 24-hour messaging window.
          </p>
        </div>
        {!editing && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEditing(true)}
            disabled={busy}
            className="rounded-full text-[11px] h-8 px-3 shrink-0"
          >
            <Plus className="size-3.5 mr-1.5" aria-hidden="true" />
            Add action
          </Button>
        )}
      </div>

      {routes.length === 0 && !editing && (
        <p className="rounded-xl border border-dashed border-[#e0e2e8] dark:border-border px-4 py-5 text-center text-xs text-muted-foreground">
          No button actions yet. Add one to make your buttons do more than open a link.
        </p>
      )}

      {routes.length > 0 && (
        <ul className="space-y-2">
          {routes.map((route) => (
            <li
              key={route.id}
              className="rounded-xl border border-[#e0e2e8] dark:border-border px-3.5 py-3 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="text-xs font-semibold font-mono truncate">{route.payload}</p>
                <p className="text-[10px] text-muted-foreground">
                  {route.action === "tag"
                    ? `Tag: ${String(route.config.tag ?? "")}`
                    : route.action === "branch"
                      ? "Send a message"
                      : "Schedule a follow-up"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void remove(route.id)}
                disabled={busy}
                aria-label={`Delete action ${route.payload}`}
                className="text-muted-foreground hover:text-destructive disabled:opacity-40"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <div className="rounded-xl border border-[#e0e2e8] dark:border-border p-4 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${baseId}-payload`} className="text-[11px]">
              Button payload
            </Label>
            <Input
              id={`${baseId}-payload`}
              value={payload}
              onChange={(event) => setPayload(event.target.value)}
              placeholder="e.g. TAG_VIP or BRANCH_OFFER"
              disabled={busy}
              className="h-8 text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              Must match the button payload you send in your DM (e.g.{" "}
              <code className="font-mono">TAG_VIP</code>).
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${baseId}-action`} className="text-[11px]">
              Action
            </Label>
            <select
              id={`${baseId}-action`}
              value={action}
              onChange={(event) => setAction(event.target.value as "tag" | "branch" | "followup")}
              disabled={busy}
              className="h-9 w-full rounded-lg border border-[#c7cad5] dark:border-border bg-background px-3 text-xs outline-none focus:border-[#4262ff] focus:ring-2 focus:ring-[#4262ff]/20"
            >
              <option value="tag">Tag the contact</option>
              <option value="branch">Send a message</option>
              <option value="followup">Schedule a follow-up</option>
            </select>
          </div>

          {action === "tag" && (
            <div className="space-y-1.5">
              <Label htmlFor={`${baseId}-tag`} className="text-[11px]">
                Tag to add
              </Label>
              <Input
                id={`${baseId}-tag`}
                value={tagValue}
                onChange={(event) => setTagValue(event.target.value)}
                placeholder="e.g. VIP, Lead, Customer"
                disabled={busy}
                className="h-8 text-xs"
              />
            </div>
          )}

          {action === "branch" && (
            <div className="space-y-1.5">
              <Label htmlFor={`${baseId}-message`} className="text-[11px]">
                Message to send
              </Label>
              <textarea
                id={`${baseId}-message`}
                rows={2}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                disabled={busy}
                className="w-full rounded-xl border border-[#c7cad5] dark:border-border bg-background px-3.5 py-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 resize-none"
              />
            </div>
          )}

          {action === "followup" && (
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor={`${baseId}-delay`} className="text-[11px]">
                  Delay (minutes)
                </Label>
                <Input
                  id={`${baseId}-delay`}
                  type="number"
                  min={1}
                  value={delayMinutes}
                  onChange={(event) => setDelayMinutes(Number(event.target.value))}
                  disabled={busy}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${baseId}-fumessage`} className="text-[11px]">
                  Follow-up message
                </Label>
                <textarea
                  id={`${baseId}-fumessage`}
                  rows={2}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  disabled={busy}
                  className="w-full rounded-xl border border-[#c7cad5] dark:border-border bg-background px-3.5 py-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 resize-none"
                />
              </div>
            </div>
          )}

          {error && (
            <p role="alert" className="text-[11px] font-medium text-destructive">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setEditing(false)}
              className="text-[11px]"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy || !payload.trim()}
              onClick={() => void save()}
              className="text-[11px] h-8"
            >
              {busy ? "Saving…" : "Save action"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
