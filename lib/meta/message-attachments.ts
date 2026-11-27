/**
 * Builds Meta Graph API message payloads from a stored format config.
 *
 * Pure: it renders variables and produces the attachment object, but performs
 * no I/O. The Graph client only needs to POST what this function returns.
 */

import { renderDmTemplate, type DmVars } from "@/lib/dm-variables";
import {
  getFormatDefinition,
  normalizeCards,
  type MessageFormatConfig,
} from "@/lib/message-formats";

export interface MetaAttachment {
  type: string;
  payload: Record<string, unknown>;
}

export interface FormattedMessage {
  text?: string;
  attachment?: MetaAttachment;
  /** Templates cannot carry companion text in the same Graph call. */
  requiresSeparateText: boolean;
  format: string;
}

function render(value: string | undefined, vars: DmVars): string {
  return renderDmTemplate(value ?? "", vars).trim();
}

export function buildFormattedMessage(
  config: MessageFormatConfig,
  vars: DmVars
): FormattedMessage {
  const format = getFormatDefinition(config.format);
  const text = render(config.text, vars);

  if (config.format === "text") {
    return { text, requiresSeparateText: false, format: config.format };
  }

  const assetUrl = render(config.asset?.url, vars);
  if (format.acceptsFile && !assetUrl) {
    // Never send a broken attachment; degrade to text instead.
    return { text, requiresSeparateText: false, format: "text" };
  }

  if (config.format === "audio") {
    return {
      text,
      attachment: { type: "audio", payload: { url: assetUrl } },
      requiresSeparateText: false,
      format: config.format,
    };
  }
  if (config.format === "pdf") {
    return {
      text,
      attachment: {
        type: "file",
        payload: {
          url: assetUrl,
          filename: config.asset?.filename || "document.pdf",
        },
      },
      requiresSeparateText: false,
      format: config.format,
    };
  }
  if (config.format === "media") {
    const mime = config.asset?.mimeType ?? "";
    return {
      text,
      attachment: {
        type: mime.startsWith("video/") ? "video" : "image",
        payload: { url: assetUrl },
      },
      requiresSeparateText: false,
      format: config.format,
    };
  }

  const cards = normalizeCards(config.cards).map((card) => {
    const buttons = card.buttonText && card.buttonUrl
      ? [
          {
            type: "web_url",
            title: render(card.buttonText, vars).slice(0, 20),
            url: render(card.buttonUrl, vars),
          },
        ]
      : [];
    return {
      title: render(card.title, vars).slice(0, 80),
      ...(card.subtitle ? { subtitle: render(card.subtitle, vars).slice(0, 80) } : {}),
      ...(card.imageUrl ? { image_url: render(card.imageUrl, vars) } : {}),
      ...(buttons.length > 0 ? { buttons } : {}),
    };
  });

  if (cards.length === 0) {
    return { text, requiresSeparateText: false, format: "text" };
  }

  return {
    text,
    attachment: {
      type: "template",
      payload: { template_type: "generic", elements: cards },
    },
    requiresSeparateText: text.length > 0,
    format: config.format,
  };
}
