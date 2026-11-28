/**
 * Message format catalogue — client-safe, no I/O.
 *
 * Instagram Messaging supports text, audio, image, video, file (PDF) and
 * generic-template cards/carousels. Binary assets live in Cloudflare R2 and
 * are delivered by public URL; this module only describes and validates them.
 */

export type MessageFormat =
  | "text"
  | "audio"
  | "pdf"
  | "media"
  | "card"
  | "carousel";

export interface FormatDefinition {
  id: MessageFormat;
  label: string;
  description: string;
  acceptsFile: boolean;
  acceptsCards: boolean;
  maxItems: number;
  maxBytes: number;
  acceptedMime: string[];
}

const IMAGE = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const AUDIO = ["audio/aac", "audio/m4a", "audio/mp4", "audio/wav", "audio/mpeg"];
const VIDEO = ["video/mp4", "video/ogg", "video/avi", "video/quicktime", "video/webm"];
const PDF = ["application/pdf"];

export const MESSAGE_FORMATS: FormatDefinition[] = [
  {
    id: "text",
    label: "Text",
    description: "A simple text message with your link.",
    acceptsFile: false,
    acceptsCards: false,
    maxItems: 0,
    maxBytes: 0,
    acceptedMime: [],
  },
  {
    id: "audio",
    label: "Audio",
    description: "A voice note or audio clip (AAC, M4A, WAV, MP4).",
    acceptsFile: true,
    acceptsCards: false,
    maxItems: 1,
    maxBytes: 25 * 1024 * 1024,
    acceptedMime: AUDIO,
  },
  {
    id: "pdf",
    label: "PDF",
    description: "A document or guide as a PDF file.",
    acceptsFile: true,
    acceptsCards: false,
    maxItems: 1,
    maxBytes: 25 * 1024 * 1024,
    acceptedMime: PDF,
  },
  {
    id: "media",
    label: "Image / Video",
    description: "A photo or short video attachment.",
    acceptsFile: true,
    acceptsCards: false,
    maxItems: 1,
    maxBytes: 25 * 1024 * 1024,
    acceptedMime: [...IMAGE, ...VIDEO],
  },
  {
    id: "card",
    label: "Card",
    description: "One rich card with image, title and action button.",
    acceptsFile: false,
    acceptsCards: true,
    maxItems: 1,
    maxBytes: 0,
    acceptedMime: IMAGE,
  },
  {
    id: "carousel",
    label: "Carousel",
    description: "Up to 10 swipeable cards, each with its own link.",
    acceptsFile: false,
    acceptsCards: true,
    maxItems: 10,
    maxBytes: 0,
    acceptedMime: IMAGE,
  },
];

export const MESSAGE_FORMAT_IDS = MESSAGE_FORMATS.map((format) => format.id);

export function getFormatDefinition(format: string): FormatDefinition {
  return (
    MESSAGE_FORMATS.find((item) => item.id === format) ?? MESSAGE_FORMATS[0]
  );
}

export function isMessageFormat(value: string): value is MessageFormat {
  return MESSAGE_FORMAT_IDS.includes(value as MessageFormat);
}

export interface StoredAsset {
  url: string;
  key?: string;
  mimeType?: string;
  sizeBytes?: number;
  filename?: string;
}

export interface CardElement {
  title: string;
  subtitle?: string;
  imageUrl?: string;
  buttonText?: string;
  buttonUrl?: string;
}

export interface MessageFormatConfig {
  format: MessageFormat;
  /** Companion text (optional for rich formats). */
  text?: string;
  asset?: StoredAsset | null;
  cards?: CardElement[];
  /** Lead-capture question shown before the promise is delivered. */
  collectQuestion?: string;
  /** Whether the follower may skip the lead-capture question. */
  collectAllowSkip?: boolean;
  /** Custom property definition (options, yes/no, or free text). */
  collectCustomProperty?: {
    key: string;
    question: string;
    type: "options" | "yes_no" | "text";
    options: string[];
  };
}

export interface AssetValidation {
  ok: boolean;
  error?: string;
  ext?: string;
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "audio/aac": "aac",
  "audio/m4a": "m4a",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "audio/mpeg": "mp3",
  "video/mp4": "mp4",
  "video/ogg": "ogg",
  "video/avi": "avi",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "application/pdf": "pdf",
};

export function validateAsset(
  format: MessageFormat,
  mimeType: string,
  sizeBytes: number
): AssetValidation {
  const definition = getFormatDefinition(format);
  if (!definition.acceptsFile) {
    return { ok: false, error: `${definition.label} does not accept a file.` };
  }
  if (!definition.acceptedMime.includes(mimeType)) {
    return {
      ok: false,
      error: `Unsupported type. Allowed: ${definition.acceptedMime.join(", ")}`,
    };
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { ok: false, error: "Invalid file size." };
  }
  // Meta allows 8 MB for images but 25 MB for video/audio/files.
  const limit = mimeType.startsWith("image/")
    ? Math.min(definition.maxBytes, 8 * 1024 * 1024)
    : definition.maxBytes;
  if (sizeBytes > limit) {
    return {
      ok: false,
      error: `File exceeds ${Math.round(limit / (1024 * 1024))} MB.`,
    };
  }
  return { ok: true, ext: EXTENSIONS[mimeType] ?? "bin" };
}

export function normalizeCards(cards: CardElement[] | null | undefined): CardElement[] {
  return (cards ?? [])
    .slice(0, MESSAGE_FORMATS.find((f) => f.id === "carousel")!.maxItems)
    .map((card) => ({
      title: String(card.title ?? "").trim().slice(0, 80),
      subtitle: String(card.subtitle ?? "").trim().slice(0, 80),
      imageUrl: card.imageUrl?.trim() || undefined,
      buttonText: String(card.buttonText ?? "").trim().slice(0, 20),
      buttonUrl: card.buttonUrl?.trim() || undefined,
    }))
    .filter((card) => card.title.length > 0);
}
