"use client";

import { useEffect, useId, useState } from "react";
import {
  Check,
  FileText,
  Image as ImageIcon,
  Layers,
  Mic,
  Plus,
  Trash2,
  UploadCloud,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getFormatDefinition,
  MESSAGE_FORMATS,
  type CardElement,
  type MessageFormat,
  type StoredAsset,
} from "@/lib/message-formats";

const ICONS: Record<MessageFormat, typeof FileText> = {
  text: FileText,
  audio: Mic,
  pdf: FileText,
  media: ImageIcon,
  card: Layers,
  carousel: Layers,
};

interface MessageFormatEditorProps {
  format: MessageFormat;
  onFormatChange: (format: MessageFormat) => void;
  asset: StoredAsset | null;
  onAssetChange: (asset: StoredAsset | null) => void;
  cards: CardElement[];
  onCardsChange: (cards: CardElement[]) => void;
  disabled?: boolean;
}

export function MessageFormatEditor({
  format,
  onFormatChange,
  asset,
  onAssetChange,
  cards,
  onCardsChange,
  disabled,
}: MessageFormatEditorProps) {
  const baseId = useId();
  const definition = getFormatDefinition(format);
  const [r2Ready, setR2Ready] = useState<boolean | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/assets/sign")
      .then((res) => res.json())
      .then((data: { configured?: boolean }) => setR2Ready(Boolean(data.configured)))
      .catch(() => setR2Ready(false));
  }, []);

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const signRes = await fetch("/api/assets/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format,
          mimeType: file.type,
          sizeBytes: file.size,
          filename: file.name,
        }),
      });
      const ticket = (await signRes.json()) as {
        uploadUrl?: string;
        objectKey?: string;
        publicUrl?: string;
        error?: string;
      };
      if (!signRes.ok || !ticket.uploadUrl || !ticket.publicUrl || !ticket.objectKey) {
        throw new Error(ticket.error ?? "Could not prepare upload");
      }
      const put = await fetch(ticket.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) throw new Error("Upload failed. Check the R2 CORS policy.");
      onAssetChange({
        url: ticket.publicUrl,
        key: ticket.objectKey,
        mimeType: file.type,
        sizeBytes: file.size,
        filename: file.name,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const updateCard = (index: number, patch: Partial<CardElement>) => {
    onCardsChange(cards.map((card, i) => (i === index ? { ...card, ...patch } : card)));
  };

  return (
    <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 p-5 shadow-subtle space-y-4">
      <div className="space-y-0.5">
        <h3 className="font-semibold text-xs sm:text-sm text-foreground">
          Message format
        </h3>
        <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground">
          Choose what your followers receive in the DM. Files and media are stored securely
          on Cloudflare R2 and delivered by a fast public URL.
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="sr-only">Message format</legend>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {MESSAGE_FORMATS.map((item) => {
            const Icon = ICONS[item.id];
            const selected = format === item.id;
            return (
              <label
                key={item.id}
                className={`cursor-pointer rounded-xl border px-3 py-2.5 space-y-1 transition-colors ${
                  selected
                    ? "border-[#4262ff] bg-[#f5f3ff] dark:bg-[#4262ff]/10"
                    : "border-[#e0e2e8] dark:border-border hover:bg-[#f7f8fa]"
                }`}
              >
                <input
                  type="radio"
                  name={`${baseId}-format`}
                  className="sr-only"
                  checked={selected}
                  onChange={() => onFormatChange(item.id)}
                  disabled={disabled}
                  aria-label={item.label}
                />
                <span className="flex items-center gap-1.5 text-xs font-semibold">
                  <Icon className="size-3.5 text-[#4262ff]" aria-hidden="true" />
                  {item.label}
                  {selected && <Check className="size-3 ml-auto text-[#4262ff]" aria-hidden="true" />}
                </span>
                <span className="block text-[10px] leading-snug text-muted-foreground">
                  {item.description}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {definition.acceptsFile && (
        <div className="space-y-2 border-t border-[#e0e2e8] dark:border-border/60 pt-3.5">
          {r2Ready === false && (
            <p role="status" className="rounded-lg bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
              Cloudflare R2 is not configured yet. Ask your admin to set the R2_* environment
              variables; uploads will stay disabled until then.
            </p>
          )}
          <Label htmlFor={`${baseId}-file`} className="text-[11px]">
            Upload {definition.label.toLowerCase()}
          </Label>
          <div className="flex flex-wrap items-center gap-3">
            <Input
              id={`${baseId}-file`}
              type="file"
              accept={definition.acceptedMime.join(",")}
              disabled={disabled || !r2Ready || uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
              className="h-9 text-xs rounded-lg max-w-xs"
            />
            {uploading && (
              <span role="status" className="text-[11px] text-muted-foreground">
                Uploading to Cloudflare…
              </span>
            )}
          </div>
          {asset && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-[#e0e2e8] dark:border-border px-3 py-2">
              <span className="text-[11px] truncate">
                {asset.filename || "Attached file"} · {(asset.sizeBytes ?? 0) / 1024 < 1024
                  ? `${Math.round((asset.sizeBytes ?? 0) / 1024)} KB`
                  : `${((asset.sizeBytes ?? 0) / 1024 / 1024).toFixed(1)} MB`}
              </span>
              <button
                type="button"
                onClick={() => onAssetChange(null)}
                disabled={disabled}
                aria-label="Remove attached file"
                className="text-[11px] font-semibold text-destructive hover:underline"
              >
                Remove
              </button>
            </div>
          )}
          {asset?.mimeType?.startsWith("image/") && (
            <div
              role="img"
              aria-label="Attachment preview"
              className="h-24 rounded-lg bg-cover bg-center border border-[#e0e2e8]"
              style={{ backgroundImage: `url("${asset.url}")` }}
            />
          )}
        </div>
      )}

      {definition.acceptsCards && (
        <div className="space-y-3 border-t border-[#e0e2e8] dark:border-border/60 pt-3.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              {cards.length}/{definition.maxItems} cards
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || cards.length >= definition.maxItems}
              onClick={() =>
                onCardsChange([...cards, { title: "", subtitle: "", buttonText: "", buttonUrl: "" }])
              }
              className="rounded-full text-[11px] h-8 px-3"
            >
              <Plus className="size-3.5 mr-1.5" aria-hidden="true" />
              Add card
            </Button>
          </div>
          {cards.map((card, index) => (
            <div key={index} className="rounded-xl border border-[#e0e2e8] dark:border-border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-[11px]">Card {index + 1}</Label>
                <button
                  type="button"
                  onClick={() => onCardsChange(cards.filter((_, i) => i !== index))}
                  disabled={disabled}
                  aria-label={`Remove card ${index + 1}`}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              </div>
              <Input
                aria-label={`Card ${index + 1} title`}
                placeholder="Title"
                value={card.title}
                maxLength={80}
                disabled={disabled}
                onChange={(event) => updateCard(index, { title: event.target.value })}
                className="h-8 text-xs"
              />
              <Input
                aria-label={`Card ${index + 1} subtitle`}
                placeholder="Subtitle (optional)"
                value={card.subtitle ?? ""}
                maxLength={80}
                disabled={disabled}
                onChange={(event) => updateCard(index, { subtitle: event.target.value })}
                className="h-8 text-xs"
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  aria-label={`Card ${index + 1} button title`}
                  placeholder="Button title"
                  value={card.buttonText ?? ""}
                  maxLength={20}
                  disabled={disabled}
                  onChange={(event) => updateCard(index, { buttonText: event.target.value })}
                  className="h-8 text-xs"
                />
                <Input
                  aria-label={`Card ${index + 1} button URL`}
                  placeholder="https://…"
                  value={card.buttonUrl ?? ""}
                  disabled={disabled}
                  onChange={(event) => updateCard(index, { buttonUrl: event.target.value })}
                  className="h-8 text-xs"
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="text-[11px] font-medium text-destructive">
          {error}
        </p>
      )}
      <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
        <UploadCloud className="size-3" aria-hidden="true" />
        Assets upload directly to Cloudflare R2 — your server never handles the file bytes.
      </p>
    </Card>
  );
}
