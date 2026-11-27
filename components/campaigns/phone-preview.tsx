"use client";

import React, { useState } from "react";
import {
  Heart,
  MessageCircle,
  Send,
  Bookmark,
  ExternalLink,
  Instagram,
  ArrowLeft,
  Video,
  Plus,
  Smile,
  Globe2,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDmText } from "@/lib/meta/dm-template";
import { buildDmVars, type DmVars } from "@/lib/dm-variables";
import { shortLinkPreview } from "@/lib/link-preview";
import {
  normalizeCollectConfig,
  parseCollectField,
  renderCollectPrompt,
} from "@/lib/lead-capture";

interface PhonePreviewProps {
  postScope: "ANY_POST" | "SPECIFIC_POST" | "NEXT_POST";
  postThumbnailUrl?: string | null;
  postCaption?: string | null;
  triggerKeyword: string;
  dmMessage: string;
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
  collectRetryMessage?: string | null;
  collectSkipMessage?: string | null;
  collectSuccessMessage?: string | null;
  collectSkipKeywords?: string[];
  instagramHandle?: string;
  profilePictureUrl?: string | null;
  isVerified?: boolean;
  followersCount?: number | null;
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
  postScope,
  postThumbnailUrl,
  postCaption,
  triggerKeyword,
  dmMessage,
  dmVariantCount = 0,
  messageFormat = "text",
  messageAsset,
  cards = [],
  shortLinksEnabled = false,
  buttonText,
  buttonUrl,
  publicReplyEnabled,
  publicReplyMessages,
  followGateEnabled = false,
  followGateOpeningMessage,
  followGateButtonLabel,
  collectField,
  collectRetryMessage,
  collectSkipMessage,
  collectSuccessMessage,
  collectSkipKeywords,
  instagramHandle = "yourbrand",
  profilePictureUrl = null,
  isVerified = false,
  followersCount = null,
}: PhonePreviewProps) {
  const [activeTab, setActiveTab] = useState<"dm" | "post">("dm");
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
  const formattedDm = previewText(dmMessage, sampleVars);
  const formattedOpening = previewText(
    followGateOpeningMessage || "Follow the account, then tap below to get your {keyword}. 👇",
    sampleVars
  );
  const collect = parseCollectField(collectField);
  const collectConfig = normalizeCollectConfig({
    retryMessage: collectRetryMessage,
    skipMessage: collectSkipMessage,
    successMessage: collectSuccessMessage,
    skipKeywords: collectSkipKeywords,
  });
  const collectPrompt = collect ? renderCollectPrompt(collect, collectConfig) : null;
  const sampleReply =
    collect?.kind === "email"
      ? "alex@example.com"
      : collect?.kind === "phone"
        ? "+91 98765 43210"
        : collect?.kind === "name"
          ? "Alex"
          : "Acme Inc";
  const linkMatch = formattedDm.match(/https?:\/\/[^\s]+/);
  const linkUrl = linkMatch?.[0] || buttonUrl || "";
  let linkHost = "";
  try {
    linkHost = new URL(linkUrl).hostname.replace(/^www\./, "");
  } catch {
    linkHost = "dmplease.vercel.app";
  }

  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center gap-1 p-1 rounded-full border border-[#e0e2e8] dark:border-border/80 bg-[#f7f8fa] dark:bg-muted/30 text-xs font-semibold mb-5">
        {(["dm", "post"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-4 py-1.5 rounded-full transition-colors text-[11px]",
              activeTab === tab
                ? "bg-[#1c1c1e] text-white shadow-sm dark:bg-white dark:text-[#1c1c1e]"
                : "text-[#6b6f7e] dark:text-[#9aa0ad] hover:text-foreground"
            )}
          >
            {tab === "dm" ? "Direct Message" : "Post & Comment"}
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

          {activeTab === "dm" ? (
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

              {/* Thread */}
              <div className="flex-1 overflow-y-auto px-3.5 py-4 flex flex-col justify-end gap-3 bg-white dark:bg-black">
                <div className="flex items-center gap-2 my-1">
                  <div className="h-px flex-1 bg-[#dbdbdb] dark:bg-[#262626]" />
                  <span className="text-[10px] text-[#8e8e8e] whitespace-nowrap">
                    Commented “{triggerKeyword || "START"}”
                  </span>
                  <div className="h-px flex-1 bg-[#dbdbdb] dark:bg-[#262626]" />
                </div>

                {/* Incoming follower message */}
                <div className="flex items-end gap-2">
                  <div className="size-6 rounded-full bg-[#efefef] dark:bg-[#363636] grid place-items-center text-[9px] font-semibold text-[#8e8e8e] shrink-0">
                    F
                  </div>
                  <div className="max-w-[210px] rounded-[20px] rounded-bl-sm bg-[#efefef] dark:bg-[#262626] px-3 py-2 text-[12px] leading-[1.45] break-words whitespace-pre-wrap">
                    {triggerKeyword || "START"}
                  </div>
                </div>

                {followGateEnabled && (
                  <div className="space-y-2">
                    <p className="text-center text-[9px] font-semibold uppercase tracking-wide text-[#8e8e8e]">
                      Follow gate · step 1 of 2
                    </p>
                    <div className="flex flex-col items-end gap-1">
                      <div className="max-w-[248px] rounded-[20px] rounded-br-sm px-3 py-2.5 text-[12px] leading-[1.45] text-white bg-gradient-to-br from-[#515bd4] via-[#d62976] to-[#f58529] break-words whitespace-pre-wrap shadow-sm">
                        <p>{formattedOpening}</p>
                        <div className="mt-2 flex items-center justify-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-[11px] font-semibold text-[#262626]">
                          <span>{followGateButtonLabel || "I'm following ✅"}</span>
                          <Check className="size-3" aria-hidden="true" />
                        </div>
                      </div>
                      <span className="text-[9px] text-[#8e8e8e] pr-1">Tap to verify</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-px flex-1 bg-[#dbdbdb] dark:bg-[#262626]" />
                      <span className="text-[9px] text-[#8e8e8e]">after follow is confirmed</span>
                      <div className="h-px flex-1 bg-[#dbdbdb] dark:bg-[#262626]" />
                    </div>
                  </div>
                )}

                {/* Brand reply — Instagram gradient bubble */}
                {followGateEnabled && (
                  <p className="text-center text-[9px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                    Step 2 of 2 · verified DM
                  </p>
                )}
                <div className="flex flex-col items-end gap-1">
                  <div className="max-w-[248px] rounded-[20px] rounded-br-sm px-3 py-2.5 text-[12px] leading-[1.45] text-white bg-gradient-to-br from-[#515bd4] via-[#d62976] to-[#f58529] break-words whitespace-pre-wrap shadow-sm">
                    <p>{formattedDm}</p>
                    {dmVariantCount > 0 && (
                      <p className="mt-1.5 text-[9px] text-white/70">
                        +{dmVariantCount} more variation{dmVariantCount === 1 ? "" : "s"} · rotated automatically
                      </p>
                    )}

                    {messageAsset && !["card", "carousel"].includes(messageFormat) && (
                      <div className="mt-2 rounded-xl bg-black/25 border border-white/25 px-2.5 py-2 text-[10px]">
                        {messageAsset.mimeType?.startsWith("image/")
                          ? "📷 Image attachment"
                          : messageAsset.mimeType?.startsWith("video/")
                            ? "🎬 Video attachment"
                            : messageAsset.mimeType?.startsWith("audio/")
                              ? "🎙️ Audio attachment"
                              : "📄 PDF attachment"}
                        <span className="block text-white/70 truncate">
                          {messageAsset.filename || "Attached file"}
                        </span>
                      </div>
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

                    {linkUrl && (
                      <div className="mt-2.5 rounded-xl bg-black/25 border border-white/25 overflow-hidden">
                        <div className="flex items-center gap-2 px-2.5 py-2">
                          <span className="grid size-7 place-items-center rounded-lg bg-white/20 shrink-0">
                            <Globe2 className="size-3.5" />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-[11px]">
                              {linkHost}
                            </p>
                            <p className="truncate text-[10px] text-white/75">
                              Open link
                            </p>
                          </div>
                          <ExternalLink className="size-3 ml-auto opacity-80" />
                        </div>
                      </div>
                    )}

                    {buttonText && (
                      <div className="mt-2 flex items-center justify-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-[11px] font-semibold text-[#262626]">
                        <span>{buttonText}</span>
                        <ExternalLink className="size-3" />
                      </div>
                    )}
                  </div>
                  <span className="text-[9px] text-[#8e8e8e] pr-1">Seen · now</span>
                </div>

                {collectPrompt && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="h-px flex-1 bg-[#dbdbdb] dark:bg-[#262626]" />
                      <span className="text-[9px] font-semibold uppercase tracking-wide text-[#8e8e8e]">
                        Collect info
                      </span>
                      <div className="h-px flex-1 bg-[#dbdbdb] dark:bg-[#262626]" />
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      <div className="max-w-[248px] rounded-[20px] rounded-br-sm px-3 py-2.5 text-[12px] leading-[1.45] text-white bg-gradient-to-br from-[#515bd4] via-[#d62976] to-[#f58529] break-words whitespace-pre-wrap shadow-sm">
                        <p>{collectPrompt}</p>
                      </div>
                    </div>

                    <div className="flex items-end gap-2">
                      <div className="size-6 rounded-full bg-[#efefef] dark:bg-[#363636] grid place-items-center text-[9px] font-semibold text-[#8e8e8e] shrink-0">
                        F
                      </div>
                      <div className="max-w-[210px] rounded-[20px] rounded-bl-sm bg-[#efefef] dark:bg-[#262626] px-3 py-2 text-[12px] leading-[1.45] break-words whitespace-pre-wrap">
                        {sampleReply}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      <div className="max-w-[248px] rounded-[20px] rounded-br-sm px-3 py-2.5 text-[12px] leading-[1.45] text-white bg-gradient-to-br from-[#515bd4] via-[#d62976] to-[#f58529] break-words whitespace-pre-wrap shadow-sm">
                        <p>{collectConfig.successMessage}</p>
                      </div>
                      <span className="text-[9px] text-[#8e8e8e] pr-1">
                        Saved to Contacts
                      </span>
                    </div>

                    <p className="text-center text-[9px] text-[#8e8e8e]">
                      Invalid reply → “{collectConfig.retryMessage}”
                    </p>
                    <p className="text-center text-[9px] text-[#8e8e8e]">
                      Reply {collectConfig.skipKeywords[0]?.toUpperCase() ?? "SKIP"} → skip
                    </p>
                  </div>
                )}

                {publicReplyEnabled && (
                  <p className="text-center text-[10px] text-[#8e8e8e]">
                    Public reply: {publicReplyMessages?.[0] || "Sent you a DM! 📩"}
                    {(publicReplyMessages?.length ?? 0) > 1 && (
                      <span className="block text-[9px]">
                        +{(publicReplyMessages?.length ?? 0) - 1} more variants, rotated automatically
                      </span>
                    )}
                  </p>
                )}
              </div>

              {/* Composer */}
              <div className="px-3 py-2 border-t border-[#dbdbdb] dark:border-[#262626] flex items-center gap-2.5">
                <Plus className="size-4 shrink-0" />
                <div className="flex-1 h-8 rounded-full border border-[#dbdbdb] dark:border-[#363636] px-3 flex items-center text-[11px] text-[#8e8e8e]">
                  Message...
                </div>
                <Smile className="size-4 shrink-0" />
                <Heart className="size-4 shrink-0" />
                <Send className="size-4 shrink-0 text-[#0095f6]" />
              </div>
            </>
          ) : (
            <>
              {/* Instagram post */}
              <div className="px-3 py-2 flex items-center gap-2 border-b border-[#dbdbdb] dark:border-[#262626]">
                <Avatar src={profilePictureUrl} handle={instagramHandle} size="sm" />
                <p className="flex items-center gap-1 font-semibold text-[11px]">
                  <span className="truncate">{instagramHandle}</span>
                  <VerifiedMark verified={isVerified} />
                </p>
              </div>

              <div className="aspect-square w-full bg-[#efefef] dark:bg-[#1a1a1a] overflow-hidden grid place-items-center">
                {postThumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={postThumbnailUrl}
                    alt="Selected post"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="text-center text-[#8e8e8e] px-6 space-y-2">
                    <Instagram className="size-8 mx-auto stroke-1" />
                    <p className="text-[10px] leading-snug">
                      {postScope === "ANY_POST"
                        ? "Responds to every post and reel"
                        : postScope === "NEXT_POST"
                          ? "Starts with your next upload — its link is attached automatically"
                          : "Attached to the selected post"}
                    </p>
                  </div>
                )}
              </div>

              <div className="px-3 py-2 flex items-center justify-between">
                <div className="flex items-center gap-3.5">
                  <Heart className="size-[18px]" />
                  <MessageCircle className="size-[18px] -scale-x-100" />
                  <Send className="size-[18px]" />
                </div>
                <Bookmark className="size-[18px]" />
              </div>

              <div className="px-3 pb-2 text-[11px] leading-snug">
                <p className="line-clamp-2">
                  <span className="font-semibold mr-1">{instagramHandle}</span>
                  {postCaption || "Your caption appears here."}
                </p>
              </div>

              <div className="flex-1 px-3 py-2 border-t border-[#dbdbdb] dark:border-[#262626] space-y-3 overflow-y-auto">
                <div className="flex items-start gap-2">
                  <div className="size-5 rounded-full bg-[#efefef] dark:bg-[#363636] grid place-items-center text-[9px] text-[#8e8e8e] shrink-0">
                    F
                  </div>
                  <p className="text-[11px]">
                    <span className="font-semibold mr-1">follower</span>
                    <span className="font-semibold">{triggerKeyword || "START"}</span> please! 🙌
                    <span className="block text-[9px] text-[#8e8e8e] mt-0.5">1m · Reply</span>
                  </p>
                </div>
                {publicReplyEnabled && (
                  <div className="flex items-start gap-2 pl-6">
                    <Avatar src={profilePictureUrl} handle={instagramHandle} size="sm" />
                    <p className="text-[11px]">
                      <span className="font-semibold mr-1">{instagramHandle}</span>
                      {publicReplyMessages?.[0] || "Sent you a DM! 📩"}
                      <span className="block text-[9px] text-[#8e8e8e] mt-0.5">Now · Reply</span>
                    </p>
                  </div>
                )}
              </div>
            </>
          )}

          <div className="h-5 flex items-center justify-center">
            <div className="w-24 h-1 rounded-full bg-[#262626] dark:bg-[#efefef]" />
          </div>
        </div>
      </div>
    </div>
  );
}
