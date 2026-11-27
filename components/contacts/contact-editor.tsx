"use client";

import { useId, useState } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateContact } from "@/app/dashboard/contacts/actions";

interface ContactEditorProps {
  contactId: string;
  workspaceId: string;
  initialTags: string[];
  initialProperties: Record<string, unknown>;
  initialStatus: "new" | "contacted" | "qualified" | "customer" | "archived";
  initialNotes: string | null;
}

const STATUS_OPTIONS = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "customer", label: "Customer" },
  { value: "archived", label: "Archived" },
] as const;

export function ContactEditor({
  contactId,
  workspaceId,
  initialTags,
  initialProperties,
  initialStatus,
  initialNotes,
}: ContactEditorProps) {
  const baseId = useId();
  const [tags, setTags] = useState<string[]>(initialTags);
  const [tagDraft, setTagDraft] = useState("");
  const [properties, setProperties] = useState<Array<{ key: string; value: string }>>(
    Object.entries(initialProperties ?? {}).map(([key, value]) => ({
      key,
      value: typeof value === "object" ? JSON.stringify(value) : String(value ?? ""),
    }))
  );
  const [status, setStatus] = useState(initialStatus);
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const addTag = () => {
    const value = tagDraft.trim();
    if (!value) return;
    if (!tags.includes(value)) setTags([...tags, value]);
    setTagDraft("");
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    const propertyMap: Record<string, string> = {};
    for (const row of properties) {
      const key = row.key.trim();
      if (!key) continue;
      propertyMap[key] = row.value;
    }
    try {
      const result = await updateContact({
        contactId,
        workspaceId,
        tags,
        properties: propertyMap,
        status,
        notes: notes.trim() || null,
      });
      if (!result.success) {
        setError(result.error ?? "Could not save the contact.");
        return;
      }
      setSaved(true);
    } catch {
      setError("Network error while saving.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${baseId}-status`} className="text-[11px]">
          Status
        </Label>
        <select
          id={`${baseId}-status`}
          value={status}
          onChange={(event) => setStatus(event.target.value as typeof status)}
          disabled={busy}
          className="h-9 w-full rounded-lg border border-[#c7cad5] dark:border-border bg-background px-3 text-xs outline-none focus:border-[#4262ff] focus:ring-2 focus:ring-[#4262ff]/20"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${baseId}-tags`} className="text-[11px]">
          Tags
        </Label>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-[#f5f3ff] dark:bg-[#4262ff]/20 px-2.5 py-1 text-[10px] font-semibold text-[#4262ff] dark:text-[#8b9eff]"
            >
              {tag}
              <button
                type="button"
                onClick={() => setTags(tags.filter((item) => item !== tag))}
                aria-label={`Remove tag ${tag}`}
                className="hover:text-destructive"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            id={`${baseId}-tags`}
            value={tagDraft}
            onChange={(event) => setTagDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addTag();
              }
            }}
            placeholder="Add a tag and press Enter"
            disabled={busy}
            className="h-8 text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addTag}
            disabled={busy || !tagDraft.trim()}
            className="h-8 text-[11px]"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Add
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-[11px]">Custom properties</Label>
        <div className="space-y-2">
          {properties.map((row, index) => (
            <div key={index} className="flex gap-2">
              <Input
                value={row.key}
                onChange={(event) => {
                  const next = [...properties];
                  next[index] = { ...next[index], key: event.target.value };
                  setProperties(next);
                }}
                placeholder="key"
                aria-label={`Property ${index + 1} name`}
                disabled={busy}
                className="h-8 text-xs w-1/3"
              />
              <Input
                value={row.value}
                onChange={(event) => {
                  const next = [...properties];
                  next[index] = { ...next[index], value: event.target.value };
                  setProperties(next);
                }}
                placeholder="value"
                aria-label={`Property ${index + 1} value`}
                disabled={busy}
                className="h-8 text-xs flex-1"
              />
              <button
                type="button"
                onClick={() => setProperties(properties.filter((_, i) => i !== index))}
                aria-label={`Remove property ${index + 1}`}
                disabled={busy}
                className="text-muted-foreground hover:text-destructive disabled:opacity-40"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setProperties([...properties, { key: "", value: "" }])}
          disabled={busy}
          className="h-8 text-[11px]"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Add property
        </Button>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${baseId}-notes`} className="text-[11px]">
          Notes
        </Label>
        <textarea
          id={`${baseId}-notes`}
          rows={3}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          disabled={busy}
          placeholder="Anything your team should know about this contact."
          className="w-full rounded-xl border border-[#c7cad5] dark:border-border bg-background px-3.5 py-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 resize-none"
        />
      </div>

      {error && (
        <p role="alert" className="text-[11px] font-medium text-destructive">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
          Contact saved.
        </p>
      )}

      <Button
        type="button"
        size="sm"
        onClick={() => void save()}
        disabled={busy}
        className="h-9 text-xs font-semibold rounded-full px-5"
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Save className="size-3.5" aria-hidden="true" />
        )}
        {busy ? "Saving…" : "Save contact"}
      </Button>
    </div>
  );
}
