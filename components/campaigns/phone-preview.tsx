"use client";

import React, { useState } from "react";
import {
  Heart,
  MessageCircle,
  Send,
  Bookmark,
  CheckCircle2,
  ExternalLink,
  Instagram,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface PhonePreviewProps {
  postScope: "ANY_POST" | "SPECIFIC_POST" | "NEXT_POST";
  postThumbnailUrl?: string | null;
  postCaption?: string | null;
  triggerKeyword: string;
  dmMessage: string;
  buttonText?: string | null;
  buttonUrl?: string | null;
  publicReplyEnabled?: boolean;
  publicReplyMessage?: string | null;
  instagramHandle?: string;
}

export function PhonePreview({
  postScope,
  postThumbnailUrl,
  postCaption,
  triggerKeyword,
  dmMessage,
  buttonText,
  buttonUrl,
  publicReplyEnabled,
  publicReplyMessage,
  instagramHandle = "yourbrand",
}: PhonePreviewProps) {
  const [activeTab, setActiveTab] = useState<"dm" | "post">("dm");

  const formattedDm = dmMessage
    ? dmMessage.replace(/{username}/gi, "@follower").replace(/{link}/gi, buttonUrl || "https://trydmplease.com")
    : "Hey! Thanks for commenting. Here is your link: https://trydmplease.com";

  return (
    <div className="flex flex-col items-center">
      {/* ── Miro-Style Preview Switcher Pill (Liquid Glass) ── */}
      <div className="flex items-center gap-1 p-1 glass-pill rounded-full text-xs font-semibold mb-5 shadow-xs">
        <button
          type="button"
          onClick={() => setActiveTab("dm")}
          className={cn(
            "px-4 py-1.5 rounded-full transition-all text-xs font-semibold",
            activeTab === "dm"
              ? "bg-[#1c1c1e] text-white shadow-xs dark:bg-white dark:text-[#1c1c1e]"
              : "text-[#6b6f7e] hover:text-foreground"
          )}
        >
          Direct Message View
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("post")}
          className={cn(
            "px-4 py-1.5 rounded-full transition-all text-xs font-semibold",
            activeTab === "post"
              ? "bg-[#1c1c1e] text-white shadow-xs dark:bg-white dark:text-[#1c1c1e]"
              : "text-[#6b6f7e] hover:text-foreground"
          )}
        >
          Post & Comment View
        </button>
      </div>

      {/* ── Realistic Phone Frame ── */}
      <div className="w-[320px] h-[610px] rounded-[44px] bg-neutral-950 p-3 shadow-2xl ring-1 ring-neutral-800 relative select-none">
        {/* Dynamic Island / Speaker */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 w-24 h-5 bg-black rounded-full z-30 flex items-center justify-end px-2.5">
          <div className="size-2 rounded-full bg-neutral-800" />
        </div>

        {/* Screen Bezel */}
        <div className="w-full h-full bg-white dark:bg-neutral-900 rounded-[34px] overflow-hidden flex flex-col justify-between relative text-neutral-900 dark:text-neutral-100 text-xs">
          
          {/* Status Bar */}
          <div className="h-10 pt-2 px-6 flex items-center justify-between text-[11px] font-semibold z-20">
            <span>9:41</span>
            <div className="flex items-center gap-1.5 text-[10px]">
              <span>5G</span>
              <div className="w-4 h-2 rounded-xs border border-current p-0.5">
                <div className="h-full w-full bg-current rounded-2xs" />
              </div>
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════════ */}
          {/* TAB 1: Direct Message View                                 */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {activeTab === "dm" && (
            <div className="flex-1 flex flex-col justify-between overflow-hidden">
              {/* Instagram Direct Header */}
              <div className="px-4 py-2 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="size-8 rounded-full bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 p-0.5">
                    <div className="w-full h-full rounded-full bg-white dark:bg-neutral-900 flex items-center justify-center font-bold text-[10px]">
                      HW
                    </div>
                  </div>
                  <div>
                    <p className="font-semibold text-xs flex items-center gap-1">
                      {instagramHandle}
                      <CheckCircle2 className="size-3 text-sky-500 fill-sky-500 text-white" />
                    </p>
                    <p className="text-[10px] text-neutral-400">Instagram</p>
                  </div>
                </div>
                <Instagram className="size-4 text-neutral-400" />
              </div>

              {/* Message Stream */}
              <div className="flex-1 p-3.5 space-y-3 overflow-y-auto flex flex-col justify-end">
                <div className="text-center">
                  <span className="text-[10px] text-neutral-400 bg-neutral-100 dark:bg-neutral-800/80 px-2 py-0.5 rounded-full">
                    Triggered by &ldquo;{triggerKeyword || "START"}&rdquo;
                  </span>
                </div>

                {/* Sent DM Bubble */}
                <div className="flex flex-col items-end space-y-1">
                  <div className="max-w-[240px] rounded-2xl rounded-tr-xs bg-neutral-900 text-white dark:bg-white dark:text-neutral-950 p-3 space-y-2.5 shadow-sm">
                    <p className="text-xs leading-relaxed break-words whitespace-pre-wrap">
                      {formattedDm}
                    </p>

                    {/* Interactive Button in DM */}
                    {buttonText && (
                      <div className="pt-1">
                        <div className="w-full py-1.5 px-3 rounded-xl bg-white/20 dark:bg-neutral-900/15 border border-white/30 dark:border-neutral-900/20 text-center font-semibold text-[11px] flex items-center justify-center gap-1.5">
                          <span>{buttonText}</span>
                          <ExternalLink className="size-3 shrink-0" />
                        </div>
                      </div>
                    )}
                  </div>
                  <span className="text-[9px] text-neutral-400 pr-1 flex items-center gap-1">
                    <CheckCircle2 className="size-2.5 text-emerald-500" /> Delivered instantly
                  </span>
                </div>
              </div>

              {/* Fake DM input */}
              <div className="p-3 border-t border-neutral-100 dark:border-neutral-800 flex items-center gap-2">
                <div className="flex-1 h-8 rounded-full bg-neutral-100 dark:bg-neutral-800 px-3 flex items-center text-[11px] text-neutral-400">
                  Message...
                </div>
                <div className="size-7 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-400">
                  <Send className="size-3.5" />
                </div>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════ */}
          {/* TAB 2: Post & Public Comment View                          */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {activeTab === "post" && (
            <div className="flex-1 flex flex-col justify-between overflow-hidden">
              {/* Post Header */}
              <div className="px-3 py-1.5 flex items-center gap-2 border-b border-neutral-100 dark:border-neutral-800">
                <div className="size-6 rounded-full bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 p-0.5">
                  <div className="w-full h-full rounded-full bg-white dark:bg-neutral-900 flex items-center justify-center font-bold text-[8px]">
                    HW
                  </div>
                </div>
                <span className="font-semibold text-[11px]">{instagramHandle}</span>
              </div>

              {/* Post Image / Reel Thumbnail */}
              <div className="relative aspect-square w-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden flex items-center justify-center">
                {postThumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={postThumbnailUrl}
                    alt="Post"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="text-center p-4 text-neutral-400 space-y-1">
                    <Instagram className="size-8 mx-auto stroke-1" />
                    <p className="text-[10px] font-medium">
                      {postScope === "ANY_POST"
                        ? "Applies to Any Post / Reel"
                        : postScope === "NEXT_POST"
                        ? "Applies to Next Upload"
                        : "Post Selected"}
                    </p>
                  </div>
                )}
              </div>

              {/* Post Actions Bar */}
              <div className="p-2.5 flex items-center justify-between text-neutral-600 dark:text-neutral-400 border-b border-neutral-100 dark:border-neutral-800">
                <div className="flex items-center gap-3">
                  <Heart className="size-4" />
                  <MessageCircle className="size-4 text-neutral-900 dark:text-white" />
                  <Send className="size-4" />
                </div>
                <Bookmark className="size-4" />
              </div>

              {/* Simulated Comments Section */}
              <div className="flex-1 p-3 space-y-2 overflow-y-auto text-[11px]">
                {/* Follower Comment */}
                <div className="flex items-start gap-2">
                  <div className="size-5 rounded-full bg-neutral-200 dark:bg-neutral-700 shrink-0 font-bold text-[8px] flex items-center justify-center">
                    F
                  </div>
                  <div>
                    <p>
                      <span className="font-bold">follower_user</span>{" "}
                      <span className="font-semibold text-neutral-900 dark:text-white">
                        {triggerKeyword || "START"}
                      </span>{" "}
                      please! 🙌
                    </p>
                    <span className="text-[9px] text-neutral-400">1m ago &bull; Reply</span>
                  </div>
                </div>

                {/* Bot Auto-Reply (if enabled) */}
                {publicReplyEnabled && (
                  <div className="flex items-start gap-2 pl-6">
                    <div className="size-4 rounded-full bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shrink-0 font-bold text-[7px] flex items-center justify-center">
                      dm
                    </div>
                    <div>
                      <p>
                        <span className="font-bold">{instagramHandle}</span>{" "}
                        <span className="text-neutral-600 dark:text-neutral-300">
                          {publicReplyMessage || "Sent you a DM! 📩"}
                        </span>
                      </p>
                      <span className="text-[9px] text-neutral-400">Just now &bull; Reply</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Home Indicator */}
          <div className="h-4 flex items-center justify-center">
            <div className="w-24 h-1 bg-neutral-300 dark:bg-neutral-700 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
