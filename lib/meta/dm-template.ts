/**
 * Pure DM template helpers.
 *
 * Kept in their own module so the webhook processor, the content builder and
 * tests can share one definition of how placeholders and URLs are rendered.
 * No I/O and no framework imports live here.
 */

import { buildDmVars, renderDmTemplate, type DmVars } from "@/lib/dm-variables";

/**
 * Backwards-compatible wrapper around the shared variable engine.
 * Accepts the legacy three fields plus every newer variable.
 */
export function personalizeMessage(
  template: string | null | undefined,
  vars: DmVars
): string {
  return renderDmTemplate(template, buildDmVars(vars));
}

/**
 * Adds short attribution params to the real destination URL. We deliberately
 * do not replace it with a signed /go/ token: Instagram does not linkify those
 * long URLs in DM text, and the creator asked for the actual link to be sent.
 */
export function linkForMessage(url: string, campaignId: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("utm_source", "dmplease");
    parsed.searchParams.set("utm_medium", "instagram_dm");
    parsed.searchParams.set("utm_campaign", campaignId.slice(0, 8));
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Instagram only linkifies a URL when it is a clean, whitespace-delimited
 * token. Bare URLs embedded mid-sentence often arrive as plain text, so pull
 * every URL onto its own line and strip attached punctuation.
 */
export function formatDmText(template: string, vars: DmVars): string {
  return personalizeMessage(template, vars)
    .replace(/https?:\/\/[^\s<]+/g, (url) => {
      const clean = url.replace(/[.,;:!?)\]}]+$/g, "");
      return `\n\n${clean}\n`;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}
