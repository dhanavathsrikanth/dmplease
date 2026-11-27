/**
 * Builds the actual DM payload for an automation.
 *
 * Link resolution lives here instead of being scattered across each send path,
 * so comment replies, opt-in releases and retries all attach the same reel
 * permalink with the same attribution rules.
 */

import { usesReelPermalink } from "@/lib/reel-link";
import { formatDmText, linkForMessage, personalizeMessage } from "@/lib/meta/dm-template";
import { resolveReelPermalink } from "@/lib/meta/reel-link-resolver";
import { resolveDmVars } from "@/lib/meta/dm-variable-resolver";
import type { DmVars } from "@/lib/dm-variables";
import {
  buildFormattedMessage,
  type FormattedMessage,
} from "@/lib/meta/message-attachments";
import type { MessageFormatConfig } from "@/lib/message-formats";
import { resolveCampaignLink } from "@/lib/meta/link-resolver";

export interface DmContentAutomation {
  id: string;
  postScope?: string | null;
  buttonUrl?: string | null;
  dmMessage: string;
  messageFormat?: string | null;
  messageAssets?: MessageFormatConfig | null;
  shortLinksEnabled?: boolean | null;
  linkRotatorId?: string | null;
}

export interface DmContentInput {
  auto: DmContentAutomation;
  token: string;
  accountId: string;
  /** The media the comment/reply belongs to. Auto links resolve from this. */
  mediaId?: string | null;
  keyword: string;
  username?: string | null;
  workspaceId?: string;
  contactId?: string | null;
  recipientId?: string | null;
  /** Short prefix for generated voucher codes, e.g. the campaign name. */
  voucherPrefix?: string | null;
  shortLinksEnabled?: boolean;
  linkRotatorId?: string | null;
  sequenceStep?: number | null;
}

export interface DmContent {
  /** Final, clickable message text. */
  text: string;
  /** Template variables, reused for the optional public comment reply. */
  vars: DmVars;
  /** Tracked absolute URL, or empty when there is nothing safe to send. */
  buttonUrl: string;
  /** How the destination URL was obtained — useful for diagnostics. */
  linkSource: "static" | "auto" | "unavailable" | "none";
  /** Ready-to-send Graph payload for rich formats. */
  formatted: FormattedMessage;
}

export async function buildAutomationContent(
  input: DmContentInput
): Promise<DmContent> {
  let rawUrl = (input.auto.buttonUrl ?? "").trim();
  let linkSource: DmContent["linkSource"] = rawUrl ? "static" : "none";

  if (usesReelPermalink(input.auto)) {
    linkSource = "unavailable";
    const resolved = await resolveReelPermalink(input.token, input.mediaId);
    // Never send the sentinel itself as a URL or postback payload. If Meta is
    // unavailable we drop the link rather than send a stale or bogus one.
    rawUrl = resolved.permalink ?? "";
    if (rawUrl) linkSource = "auto";
  }

  const trackedBaseUrl = rawUrl
    ? linkForMessage(personalizeMessage(rawUrl, { keyword: input.keyword }), input.auto.id)
    : "";

  // Resolve contact/voucher variables from the final link so `{voucher_url}`
  // is built from the same tracked URL the button will use.
  const { vars } = input.workspaceId
    ? await resolveDmVars({
        workspaceId: input.workspaceId,
        template: input.auto.dmMessage,
        scopeKey: `auto:${input.auto.id}`,
        contactId: input.contactId,
        recipientId: input.recipientId,
        username: input.username,
        keyword: input.keyword,
        link: trackedBaseUrl,
        prefix: input.voucherPrefix,
      })
    : {
        vars: {
          username: input.username || "there",
          keyword: input.keyword,
          link: trackedBaseUrl,
        } as DmVars,
      };

  let outboundUrl = trackedBaseUrl;
  if (input.workspaceId && input.recipientId && trackedBaseUrl) {
    const resolved = await resolveCampaignLink({
      workspaceId: input.workspaceId,
      automationId: input.auto.id,
      recipientId: input.recipientId,
      contactId: input.contactId,
      destination: trackedBaseUrl,
      shortLinksEnabled: input.shortLinksEnabled,
      linkRotatorId: input.linkRotatorId,
      postId: input.mediaId,
      keyword: input.keyword,
      sequenceStep: input.sequenceStep ?? 1,
    });
    outboundUrl = resolved.url;
  }

  const varsWithLink: DmVars = { ...vars, link: outboundUrl };

  const config: MessageFormatConfig = {
    format: (input.auto.messageFormat as MessageFormatConfig["format"]) || "text",
    text: input.auto.dmMessage,
    asset: input.auto.messageAssets?.asset ?? null,
    cards: input.auto.messageAssets?.cards ?? [],
  };
  const formatted = buildFormattedMessage(config, varsWithLink);

  return {
    text: formatDmText(input.auto.dmMessage, varsWithLink),
    vars: varsWithLink,
    buttonUrl: outboundUrl,
    linkSource,
    formatted,
  };
}
