"use client";

import React from "react";
import {
  Heart,
  Send,
  ExternalLink,
  ArrowLeft,
  Video,
  Plus,
  Smile,
  FileText,
  MessageCircle,
  Bookmark,
  Instagram,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDmText } from "@/lib/meta/dm-template";
import { buildDmVars, type DmVars } from "@/lib/dm-variables";
import { shortLinkPreview } from "@/lib/link-preview";

interface PhonePreviewProps {
  triggerType?: "COMMENT" | "SHARE_TO_DM";
  postScope: "ANY_POST" | "SPECIFIC_POST" | "NEXT_POST";
  postThumbnailUrl?: string | null;
  postCaption?: string | null;
  triggerKeyword: string;
  dmMessage: string;
  composerFocused?: boolean;
  dmVariantCount?: number;
  messageFormat?: string;
  messageAsset?: {
    url: string;
    mimeType?: string;
    filename?: string;
  } | null;
  cards?: Array<{ title: string; subtitle?: string; imageUrl?: string }>;
  shortLinksEnabled?: boolean;
  buttonText?: string | null;
  buttonUrl?: string | null;
  publicReplyEnabled?: boolean;
  publicReplyMessages?: string[] | null;
  followGateEnabled?: boolean;
  followGateOpeningMessage?: string | null;
  followGateButtonLabel?: string | null;
  collectField?: string | null;
  collectQuestion?: string | null;
  collectAllowSkip?: boolean;
  collectCustomProperty?: {
    key: string;
    question: string;
    type: "options" | "yes_no" | "text";
    options: string[];
  } | null;
  collectRetryMessage?: string | null;
  collectSkipMessage?: string | null;
  collectSuccessMessage?: string | null;
  collectSkipKeywords?: string[];
  instagramHandle?: string;
  profilePictureUrl?: string | null;
  isVerified?: boolean;
  followersCount?: number | null;
  view?: "dm" | "post";
  onViewChange?: (view: "dm" | "post") => void;
}

/** Uses the production formatter so the preview shows exactly what will be sent. */
function previewText(message: string, vars: DmVars) {
  return formatDmText(
    message || "Hey! Thanks for your comment. Here is your link: {link}",
    vars
  );
}

function VerifiedMark({ verified }: { verified: boolean }) {
  if (!verified) return null;
  return (
    <span
      title="Verified"
      className="inline-grid size-3.5 shrink-0 place-items-center rounded-full bg-[#0095f6] text-white"
    >
      <svg viewBox="0 0 12 12" className="size-2.5" aria-hidden="true">
        <path
          d="M2.2 6.2 4.7 8.6 9.8 3.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function Avatar({
  src,
  handle,
  size = "md",
}: {
  src?: string | null;
  handle: string;
  size?: "sm" | "md";
}) {
  const dimension = size === "sm" ? "size-6" : "size-9";
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={`@${handle}`}
      className={cn(dimension, "rounded-full object-cover shrink-0 ring-1 ring-black/5")}
    />
  ) : (
    <div
      className={cn(
        dimension,
        "rounded-full shrink-0 bg-gradient-to-tr from-[#f9ce34] via-[#ee2a7b] to-[#6228d7]"
      )}
    />
  );
}

export function PhonePreview({
  triggerKeyword,
  dmMessage,
  composerFocused = false,
  dmVariantCount = 0,
  messageFormat = "text",
  messageAsset,
  cards = [],
  shortLinksEnabled = false,
  buttonText,
  buttonUrl,
  publicReplyEnabled = false,
  publicReplyMessages,
  postThumbnailUrl,
  postCaption,
  collectField,
  collectQuestion,
  collectAllowSkip = true,
  collectCustomProperty,
  collectRetryMessage,
  collectSuccessMessage,
  instagramHandle = "yourbrand",
  profilePictureUrl = null,
  isVerified = false,
  followersCount = null,
  view: controlledView,
  onViewChange,
}: PhonePreviewProps) {
  const [internalView, setInternalView] = React.useState<"dm" | "post">("dm");
  const view = controlledView ?? internalView;
  const setView = (next: "dm" | "post") => {
    if (controlledView === undefined) setInternalView(next);
    onViewChange?.(next);
  };
  const sampleLink = buttonUrl || "https://dmplease.vercel.app/guide";
  const sampleVars = buildDmVars({
    username: "alex",
    name: "Alex",
    email: "alex@example.com",
    phone: "+91 98765 43210",
    keyword: triggerKeyword || "GUIDE",
    link: shortLinksEnabled ? `https://${shortLinkPreview()}` : sampleLink,
    voucher: "ALEX-7K2M9Q",
    voucher_url: `${sampleLink}${sampleLink.includes("?") ? "&" : "?"}voucher=ALEX-7K2M9Q`,
  });
  const hasDmText = dmMessage.trim().length > 0;
  const formattedDm = hasDmText ? previewText(dmMessage, sampleVars) : "";
  const collectKind =
    collectField === "custom:gender"
      ? "gender"
      : collectField === "custom:age_group"
        ? "age_group"
        : collectField;

  const sampleUsername = "alex";
  const publicReplyText = (publicReplyMessages?.[0] || "Sent you a DM! 📩")
    .replace(/\{username\}/gi, sampleUsername)
    .replace(/\{keyword\}/gi, triggerKeyword || "Home");

  return (
    <div className="flex flex-col items-center">
      <div className="mb-3 flex items-center gap-1 rounded-full border border-[#e0e2e8] bg-[#f7f8fa] p-1 text-xs font-semibold dark:border-border/80 dark:bg-muted/30">
        {(["dm", "post"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setView(mode)}
            className={cn(
              "rounded-full px-3 py-1.5 text-[11px] transition-colors",
              view === mode
                ? "bg-[#1c1c1e] text-white shadow-sm dark:bg-white dark:text-[#1c1c1e]"
                : "text-[#6b6f7e] hover:text-foreground dark:text-[#9aa0ad]"
            )}
          >
            {mode === "dm" ? "DM" : "Post & comments"}
          </button>
        ))}
      </div>

      {/* Phone frame */}
      <div className="w-[320px] h-[620px] rounded-[46px] bg-[#0b0b0d] p-[9px] shadow-[0_30px_70px_-20px_rgba(0,0,0,0.55)] ring-1 ring-black/20 relative select-none">
        <div className="absolute top-[18px] left-1/2 -translate-x-1/2 w-[92px] h-[22px] bg-black rounded-full z-30" />

        <div className="w-full h-full bg-white dark:bg-[#000] rounded-[38px] overflow-hidden flex flex-col relative text-[#262626] dark:text-[#f5f5f5]">
          {/* Status bar */}
          <div className="h-11 pt-3 px-6 flex items-center justify-between text-[11px] font-semibold tracking-tight z-20">
            <span>9:41</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px]">5G</span>
              <svg viewBox="0 0 18 12" className="w-4 h-3 fill-current" aria-hidden="true">
                <rect x="0" y="7" width="3" height="5" rx="1" />
                <rect x="5" y="4" width="3" height="8" rx="1" />
                <rect x="10" y="2" width="3" height="10" rx="1" />
                <rect x="15" y="0" width="3" height="12" rx="1" opacity="0.35" />
              </svg>
              <svg viewBox="0 0 24 12" className="w-5 h-3" aria-hidden="true">
                <rect x="0.5" y="0.5" width="20" height="11" rx="3" fill="none" stroke="currentColor" />
                <rect x="2.5" y="2.5" width="15" height="7" rx="1.5" fill="currentColor" />
                <rect x="22" y="4" width="1.5" height="4" rx="1" fill="currentColor" />
              </svg>
            </div>
          </div>

          {view === "dm" ? (
            <>
          {/* Instagram Direct header */}
          <div className="px-3.5 py-2 border-b border-[#dbdbdb] dark:border-[#262626] flex items-center gap-2.5">
            <ArrowLeft className="size-4 shrink-0" />
            <Avatar src={profilePictureUrl} handle={instagramHandle} />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1 font-semibold text-[12px] leading-tight truncate">
                <span className="truncate">{instagramHandle}</span>
                <VerifiedMark verified={isVerified} />
              </p>
              <p className="text-[10px] text-[#8e8e8e] leading-tight">
                {followersCount !== null
                  ? `${followersCount.toLocaleString()} followers · Instagram`
                  : "Instagram"}
              </p>
            </div>
            <Video className="size-4 text-[#8e8e8e] shrink-0" />
          </div>

          {collectField && collectField !== "none" ? (
            <div className="flex-1 overflow-y-auto px-3.5 py-4 flex flex-col justify-end gap-3 bg-white dark:bg-black">
              <div className="flex flex-col items-end gap-1">
                <div className="max-w-[248px] rounded-[20px] rounded-br-sm px-3 py-2.5 text-[12px] leading-[1.45] text-white bg-gradient-to-br from-[#515bd4] via-[#d62976] to-[#f58529] break-words whitespace-pre-wrap shadow-sm">
                  <p>
                    {collectQuestion?.trim() ||
                      collectCustomProperty?.question?.trim() ||
                      (collectKind === "email"
                        ? "Reply with your email address to finish."
                        : collectKind === "phone"
                          ? "Reply with your phone number to finish."
                          : collectKind === "name"
                            ? "Reply with your name to finish."
                            : collectKind === "gender"
                              ? "Reply with your gender to finish."
                              : collectKind === "age_group"
                                ? "Reply with your age group to finish."
                                : "Reply with your detail to finish.")}
                  </p>
                  {collectAllowSkip && (
                    <div className="mt-2 flex items-center justify-center rounded-full bg-white/95 px-3 py-1.5 text-[11px] font-semibold text-[#262626]">
                      Skip
                    </div>
                  )}
                </div>
                <span className="text-[9px] text-[#8e8e8e] pr-1">Seen · now</span>
              </div>

              <div className="flex items-end gap-2">
                <div className="size-6 rounded-full bg-[#efefef] dark:bg-[#363636] grid place-items-center text-[9px] font-semibold text-[#8e8e8e] shrink-0">
                  F
                </div>
                <div className="max-w-[210px] rounded-[20px] rounded-bl-sm bg-[#efefef] dark:bg-[#262626] px-3 py-2 text-[12px] leading-[1.45] break-words whitespace-pre-wrap">
                  {collectKind === "email"
                    ? "not-an-email"
                    : collectKind === "phone"
                      ? "12345"
                      : collectKind === "name"
                        ? "123"
                        : collectKind === "gender"
                          ? "unknown"
                          : collectKind === "age_group"
                            ? "unknown"
                            : collectCustomProperty?.type === "yes_no"
                              ? "Maybe"
                              : "—"}
                </div>
              </div>

              {(collectKind === "email" || collectKind === "phone") && (
                <div className="flex flex-col items-end gap-1">
                  <div className="max-w-[248px] rounded-[20px] rounded-br-sm px-3 py-2.5 text-[12px] leading-[1.45] text-white bg-gradient-to-br from-[#515bd4] via-[#d62976] to-[#f58529] break-words whitespace-pre-wrap shadow-sm">
                    <p>
                      {collectRetryMessage?.trim() ||
                        (collectKind === "email"
                          ? "Please enter a valid email address."
                          : "Please enter a valid phone number.")}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex items-end gap-2">
                <div className="size-6 rounded-full bg-[#efefef] dark:bg-[#363636] grid place-items-center text-[9px] font-semibold text-[#8e8e8e] shrink-0">
                  F
                </div>
                <div className="max-w-[210px] rounded-[20px] rounded-bl-sm bg-[#efefef] dark:bg-[#262626] px-3 py-2 text-[12px] leading-[1.45] break-words whitespace-pre-wrap">
                  {collectKind === "email"
                    ? "alex@example.com"
                    : collectKind === "phone"
                      ? "+91 98765 43210"
                      : collectKind === "name"
                        ? "Alex"
                        : collectKind === "gender"
                          ? "Female"
                          : collectKind === "age_group"
                            ? "25-34"
                            : collectCustomProperty?.type === "options"
                              ? collectCustomProperty.options[0] || "Option 1"
                              : collectCustomProperty?.type === "yes_no"
                                ? "Yes"
                                : "Acme Inc"}
                </div>
              </div>

              <div className="flex flex-col items-end gap-1">
                <div className="max-w-[248px] rounded-[20px] rounded-br-sm px-3 py-2.5 text-[12px] leading-[1.45] text-white bg-gradient-to-br from-[#515bd4] via-[#d62976] to-[#f58529] break-words whitespace-pre-wrap shadow-sm">
                  <p>{collectSuccessMessage?.trim() || "Got it, thank you! ✅"}</p>
                </div>
              </div>
            </div>
          ) : (
          <div className="flex-1 overflow-y-auto px-3.5 py-4 flex flex-col justify-end gap-3 bg-white dark:bg-black">
            <div className="flex flex-col items-end gap-1">
              <div className="max-w-[248px] rounded-[20px] rounded-br-sm px-3 py-2.5 text-[12px] leading-[1.45] text-white bg-gradient-to-br from-[#515bd4] via-[#d62976] to-[#f58529] break-words whitespace-pre-wrap shadow-sm">
                {messageAsset && !["card", "carousel"].includes(messageFormat) && (
                  <div className="mb-2 overflow-hidden rounded-xl border border-white/25 bg-black/25">
                    {messageAsset.mimeType?.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={messageAsset.url}
                        alt={messageAsset.filename || "Attachment"}
                        className="max-h-40 w-full object-cover"
                      />
                    ) : messageAsset.mimeType?.startsWith("video/") ? (
                      <video
                        src={messageAsset.url}
                        controls
                        className="max-h-40 w-full object-cover"
                      />
                    ) : messageAsset.mimeType?.startsWith("audio/") ? (
                      <div className="px-2.5 py-2">
                        <audio src={messageAsset.url} controls className="w-full" />
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 px-2.5 py-2 text-[10px]">
                        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white/20">
                          <FileText className="size-3.5" />
                        </span>
                        <span className="truncate">
                          {messageAsset.filename || "PDF document"}
                        </span>
                      </div>
                    )}
                  </div>
                )}
                <p className={cn(!hasDmText && "italic text-white/70")}>
                  {hasDmText ? formattedDm : "Set up a message"}
                </p>
                {hasDmText && dmVariantCount > 0 && (
                  <p className="mt-1.5 text-[9px] text-white/70">
                    +{dmVariantCount} more variation{dmVariantCount === 1 ? "" : "s"} · rotated automatically
                  </p>
                )}
                {(messageFormat === "card" || messageFormat === "carousel") &&
                  cards.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      {cards.slice(0, messageFormat === "card" ? 1 : 3).map((card, index) => (
                        <div
                          key={index}
                          className="rounded-xl bg-black/25 border border-white/25 px-2.5 py-2 text-[10px]"
                        >
                          <p className="font-semibold">{card.title || `Card ${index + 1}`}</p>
                          {card.subtitle && (
                            <p className="text-white/70">{card.subtitle}</p>
                          )}
                          {messageFormat === "carousel" && index === 2 && cards.length > 3 && (
                            <p className="text-white/60">+{cards.length - 3} more cards</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                {buttonText && (
                  <a
                    href={buttonUrl || "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 flex items-center justify-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-[11px] font-semibold text-[#262626]"
                  >
                    <span>{buttonText}</span>
                    <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
              <span className="text-[9px] text-[#8e8e8e] pr-1">
                {hasDmText ? "Seen · now" : "Draft"}
              </span>
            </div>
          </div>
          )}

          {/* Composer */}
          <div className="px-3 py-2 border-t border-[#dbdbdb] dark:border-[#262626] flex items-center gap-2.5">
            <Plus className="size-4 shrink-0" />
            <div
              className={cn(
                "flex-1 h-8 rounded-full border px-3 flex items-center text-[11px]",
                composerFocused
                  ? "border-[#0095f6] text-[#262626] dark:text-[#f5f5f5]"
                  : "border-[#dbdbdb] dark:border-[#363636] text-[#8e8e8e]"
              )}
            >
              {composerFocused ? "Aa" : "Message..."}
            </div>
            <Smile className="size-4 shrink-0" />
            <Heart className="size-4 shrink-0" />
            <Send className="size-4 shrink-0 text-[#0095f6]" />
          </div>
            </>
          ) : (
            <div className="flex-1 overflow-y-auto bg-white dark:bg-black">
              {/* Post header */}
              <div className="flex items-center gap-2 border-b border-[#dbdbdb] px-3 py-2 dark:border-[#262626]">
                <Avatar src={profilePictureUrl} handle={instagramHandle} size="sm" />
                <p className="flex items-center gap-1 text-[11px] font-semibold">
                  <span className="truncate">{instagramHandle}</span>
                  <VerifiedMark verified={isVerified} />
                </p>
              </div>

              {/* Post media */}
              <div className="aspect-square w-full overflow-hidden bg-[#efefef] dark:bg-[#1a1a1a]">
                {postThumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={postThumbnailUrl}
                    alt="Selected post"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="grid h-full place-items-center text-center text-[#8e8e8e]">
                    <div className="space-y-2 px-6">
                      <Instagram className="mx-auto size-8 stroke-1" />
                      <p className="text-[10px] leading-snug">
                        Your post or reel appears here
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Post actions */}
              <div className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-3.5">
                  <Heart className="size-[18px]" />
                  <MessageCircle className="size-[18px] -scale-x-100" />
                  <Send className="size-[18px]" />
                </div>
                <Bookmark className="size-[18px]" />
              </div>

              {/* Caption */}
              <div className="px-3 pb-2 text-[11px] leading-snug">
                <p className="line-clamp-2">
                  <span className="mr-1 font-semibold">{instagramHandle}</span>
                  {postCaption || "Your caption appears here."}
                </p>
              </div>

              {/* Comments */}
              <div className="space-y-3 border-t border-[#dbdbdb] px-3 py-3 dark:border-[#262626]">
                <div className="flex items-start gap-2">
                  <div className="size-7 shrink-0 rounded-full bg-[#efefef] dark:bg-[#363636]" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] text-[#8e8e8e]">
                      <span className="font-semibold text-[#262626] dark:text-[#f5f5f5]">
                        follower
                      </span>{" "}
                      17w
                    </p>
                    <p className="text-[11px] leading-snug">
                      {triggerKeyword || "Home"}
                    </p>
                    <div className="mt-0.5 flex gap-3 text-[9px] text-[#8e8e8e]">
                      <span>Reply</span>
                      <span>See translation</span>
                    </div>
                  </div>
                  <Heart className="mt-1 size-3.5 shrink-0 text-[#8e8e8e]" />
                </div>

                {publicReplyEnabled && (
                  <div className="flex items-start gap-2">
                    <Avatar
                      src={profilePictureUrl}
                      handle={instagramHandle}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1 text-[10px] text-[#8e8e8e]">
                        <span className="font-semibold text-[#262626] dark:text-[#f5f5f5]">
                          {instagramHandle}
                        </span>
                        <VerifiedMark verified={isVerified} />
                        17w · Author
                      </p>
                      <p className="text-[11px] leading-snug">
                        <span className="text-[#0095f6]">
                          @{sampleUsername}
                        </span>{" "}
                        {publicReplyText}
                      </p>
                    </div>
                    <Heart className="mt-1 size-3.5 shrink-0 text-[#8e8e8e]" />
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="h-5 flex items-center justify-center">
            <div className="w-24 h-1 rounded-full bg-[#262626] dark:bg-[#efefef]" />
          </div>
        </div>
      </div>
    </div>
  );
}
