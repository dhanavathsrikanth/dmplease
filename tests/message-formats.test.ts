import { describe, expect, it } from "vitest";

import {
  normalizeCards,
  validateAsset,
  type MessageFormatConfig,
} from "@/lib/message-formats";
import { buildFormattedMessage } from "@/lib/meta/message-attachments";
import { buildDmVars } from "@/lib/dm-variables";

const vars = buildDmVars({
  username: "alex",
  name: "Alex",
  link: "https://example.com/guide",
  voucher: "ALEX-7K2M9Q",
});

const asset = {
  url: "https://cdn.example.com/file.pdf",
  filename: "guide.pdf",
  mimeType: "application/pdf",
};

describe("asset validation", () => {
  it("accepts PDFs for the pdf format", () => {
    expect(validateAsset("pdf", "application/pdf", 1024).ok).toBe(true);
  });

  it("rejects PDFs for image-only formats", () => {
    expect(validateAsset("media", "application/pdf", 1024).ok).toBe(false);
  });

  it("enforces Meta's size limits", () => {
    expect(validateAsset("audio", "audio/mp4", 26 * 1024 * 1024).ok).toBe(false);
    expect(validateAsset("media", "image/png", 9 * 1024 * 1024).ok).toBe(false);
  });
});

describe("Graph attachment payloads", () => {
  function message(config: MessageFormatConfig) {
    return buildFormattedMessage(config, vars);
  }

  it("keeps text format as plain text", () => {
    const result = message({ format: "text", text: "Hi {name}" });
    expect(result.text).toBe("Hi Alex");
    expect(result.attachment).toBeUndefined();
  });

  it("builds audio, file and media attachments", () => {
    expect(
      message({ format: "audio", text: "Listen", asset: { ...asset, mimeType: "audio/mp4", url: "https://cdn.example.com/a.m4a" } }).attachment
    ).toEqual({ type: "audio", payload: { url: "https://cdn.example.com/a.m4a" } });

    expect(message({ format: "pdf", text: "Guide", asset }).attachment).toMatchObject({
      type: "file",
      payload: { filename: "guide.pdf" },
    });

    expect(
      message({ format: "media", asset: { ...asset, mimeType: "image/png" } }).attachment?.type
    ).toBe("image");
    expect(
      message({ format: "media", asset: { ...asset, mimeType: "video/mp4" } }).attachment?.type
    ).toBe("video");
  });

  it("builds a generic-template card and carousel", () => {
    const cards = normalizeCards([
      {
        title: "Your guide",
        subtitle: "For {username}",
        imageUrl: "https://cdn.example.com/card.png",
        buttonText: "Open",
        buttonUrl: "{link}?voucher={voucher}",
      },
    ]);
    const card = message({ format: "card", text: "Here it is", cards });
    expect(card.attachment).toMatchObject({
      type: "template",
      payload: {
        template_type: "generic",
        elements: [{ title: "Your guide", subtitle: "For alex" }],
      },
    });
    expect(card.requiresSeparateText).toBe(true);

    const carousel = message({
      format: "carousel",
      cards: [{ title: "One" }, { title: "Two" }],
    });
    const elements = (carousel.attachment?.payload?.elements ?? []) as unknown[];
    expect(elements).toHaveLength(2);
  });

  it("degrades to text when an asset is missing", () => {
    expect(message({ format: "pdf", text: "No file" }).attachment).toBeUndefined();
  });
});
