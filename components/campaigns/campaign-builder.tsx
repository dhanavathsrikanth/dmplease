"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import {
  Sparkles,
  ArrowLeft,
  X,
  Instagram,
  Check,
  ExternalLink,
  Loader2,
  Clock,
  UserPlus,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhonePreview } from "@/components/campaigns/phone-preview";
import { FollowGateSettings } from "@/components/campaigns/follow-gate-settings";
import {
  FOLLOW_GATE_DEFAULTS,
  type FollowGateUnavailablePolicy,
} from "@/lib/follow-gate-constants";
import {
  createCampaign,
  updateCampaign,
} from "@/app/dashboard/campaigns/actions";
import { AUTO_REEL_LINK, isAutoReelLink } from "@/lib/reel-link";
import {
  normalizePublicReplies,
  PUBLIC_REPLY_DEFAULT,
} from "@/lib/public-replies";
import { PublicReplySettings } from "@/components/campaigns/public-reply-settings";
import {
  CONTACT_TOKENS,
  DmVariablePicker,
} from "@/components/campaigns/dm-variable-picker";
import { findDmVariables } from "@/lib/dm-variables";
import { DmVariantsEditor } from "@/components/campaigns/dm-variants-editor";
import { MessageFormatEditor } from "@/components/campaigns/message-format-editor";
import type {
  CardElement,
  MessageFormat,
  StoredAsset,
} from "@/lib/message-formats";
import { LinkRotationSettings } from "@/components/campaigns/link-rotation-settings";
import type { LinkRotatorView } from "@/app/dashboard/campaigns/link-actions";

interface InstagramMediaItem {
  id: string;
  caption: string;
  mediaType: string;
  thumbnailUrl: string;
  permalink: string;
  timestamp: string;
}

const POPULAR_KEYWORD_PILLS = ["GUIDE", "RECIPE", "VIP", "CALL", "DISCOUNT", "START"];

const RECIPES = [
  {
    id: "freebie",
    title: "Freebie / Lead Magnet",
    keyword: "GUIDE",
    dm: "Hey {username}! Here is your free training guide: {link}. Enjoy! 🙌",
    buttonText: "Download Guide 📖",
    buttonUrl: "https://dmplease.vercel.app/guide",
  },
  {
    id: "discount",
    title: "VIP Promo / Discount",
    keyword: "VIP",
    dm: "Here's your 20% off VIP code: VIP20. Shop our store here: {link} 🛍️",
    buttonText: "Shop With 20% Off 🛍️",
    buttonUrl: "https://dmplease.vercel.app/guide",
  },
  {
    id: "booking",
    title: "Discovery Call Booking",
    keyword: "CALL",
    dm: "Would love to chat with you {username}! Pick a time on my calendar here: {link} 📅",
    buttonText: "Book Discovery Call 📅",
    buttonUrl: "https://dmplease.vercel.app/guide",
  },
];

interface CampaignInitialData {
  id: string;
  name: string;
  postScope?: string | null;
  postId?: string | null;
  postThumbnailUrl?: string | null;
  postCaption?: string | null;
  triggerKeywords: string[];
  dmMessage: string;
  buttonText?: string | null;
  buttonUrl?: string | null;
  publicReplyEnabled?: boolean | null;
  publicReplyMessages?: string[] | null;
  followGateEnabled?: boolean | null;
  openingMessage?: string | null;
  followGateButtonLabel?: string | null;
  followGateOnUnavailable?: string | null;
  collectField?: string | null;
  collectRetryMessage?: string | null;
  collectSkipMessage?: string | null;
  collectSuccessMessage?: string | null;
  collectSkipKeywords?: string[] | null;
  collectMaxAttempts?: number | null;
  dmVariants?: string[] | null;
  messageFormat?: string | null;
  messageAssets?: {
    asset?: StoredAsset | null;
    cards?: CardElement[] | null;
  } | null;
  shortLinksEnabled?: boolean | null;
  linkRotatorId?: string | null;
  hourlyCap?: number | null;
  delayMinMs?: number | null;
  delayMaxMs?: number | null;
}

interface CampaignBuilderProps {
  initialHandle?: string;
  initialCampaign?: CampaignInitialData;
  mode?: "create" | "edit";
  linkRotators?: LinkRotatorView[];
}

export function CampaignBuilder({
  initialHandle,
  initialCampaign,
  mode = "create",
  linkRotators = [],
}: CampaignBuilderProps = {}) {
  const isEdit = mode === "edit";
  const router = useRouter();

  const [instagramHandle, setInstagramHandle] = useState(initialHandle || "yourbrand");
  const [profilePictureUrl, setProfilePictureUrl] = useState<string | null>(null);
  const [isVerified, setIsVerified] = useState(false);
  const [followersCount, setFollowersCount] = useState<number | null>(null);

  // Campaign State
  const [name, setName] = useState(
    initialCampaign?.name ?? "Instagram Auto-DM Campaign"
  );
  const [postScope, setPostScope] = useState<"ANY_POST" | "SPECIFIC_POST" | "NEXT_POST">(
    (initialCampaign?.postScope as "ANY_POST" | "SPECIFIC_POST" | "NEXT_POST") ?? "ANY_POST"
  );
  const [selectedPost, setSelectedPost] = useState<InstagramMediaItem | null>(
    initialCampaign?.postId
      ? {
          id: initialCampaign.postId,
          caption: initialCampaign.postCaption ?? "",
          thumbnailUrl: initialCampaign.postThumbnailUrl ?? "",
          mediaType: "",
          permalink: "",
          timestamp: "",
        }
      : null
  );

  // Live media from Instagram
  const [mediaList, setMediaList] = useState<InstagramMediaItem[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(false);

  // Triggers
  const [keywords, setKeywords] = useState<string[]>(
    initialCampaign?.triggerKeywords ?? ["GUIDE"]
  );
  const [keywordInput, setKeywordInput] = useState("");

  // DM Message & Action Button
  const [dmMessage, setDmMessage] = useState(
    initialCampaign?.dmMessage ??
      "Hey {username}! Thanks for your comment. Here is your free guide: {link}. Enjoy! 🙌"
  );
  const [dmVariants, setDmVariants] = useState<string[]>(
    () => initialCampaign?.dmVariants ?? []
  );
  const [messageFormat, setMessageFormat] = useState<MessageFormat>(
    (initialCampaign?.messageFormat as MessageFormat) || "text"
  );
  const [messageAsset, setMessageAsset] = useState<StoredAsset | null>(
    initialCampaign?.messageAssets?.asset ?? null
  );
  const [cards, setCards] = useState<CardElement[]>(
    initialCampaign?.messageAssets?.cards ?? []
  );
  const [shortLinksEnabled, setShortLinksEnabled] = useState(
    initialCampaign ? Boolean(initialCampaign.shortLinksEnabled) : true
  );
  const [linkRotatorId, setLinkRotatorId] = useState<string | null>(
    initialCampaign?.linkRotatorId ?? null
  );
  const [buttonText, setButtonText] = useState(
    initialCampaign?.buttonText ?? "Download Guide 📖"
  );
  const [collectField, setCollectField] = useState<string>(() => {
    const initial = initialCampaign?.collectField;
    if (!initial) return "none";
    if (initial === "email" || initial === "phone" || initial === "name") {
      return initial;
    }
    if (initial.startsWith("custom:")) return "custom";
    return "none";
  });
  const [collectCustomKey, setCollectCustomKey] = useState<string>(() => {
    const initial = initialCampaign?.collectField;
    return initial?.startsWith("custom:") ? initial.slice("custom:".length) : "";
  });
  const [collectRetryMessage, setCollectRetryMessage] = useState<string>(
    () => initialCampaign?.collectRetryMessage ?? ""
  );
  const [collectSkipMessage, setCollectSkipMessage] = useState<string>(
    () => initialCampaign?.collectSkipMessage ?? ""
  );
  const [collectSuccessMessage, setCollectSuccessMessage] = useState<string>(
    () => initialCampaign?.collectSuccessMessage ?? ""
  );
  const [collectSkipKeywords, setCollectSkipKeywords] = useState<string>(
    () =>
      (initialCampaign?.collectSkipKeywords ?? ["skip", "later", "no thanks", "not now"]).join(", ")
  );
  const [collectMaxAttempts, setCollectMaxAttempts] = useState<number>(
    () => initialCampaign?.collectMaxAttempts ?? 3
  );

  const [hourlyCap, setHourlyCap] = useState<number>(() =>
    typeof initialCampaign?.hourlyCap === "number" ? initialCampaign.hourlyCap : 0
  );
  const [delayMinMs, setDelayMinMs] = useState<number>(() =>
    typeof initialCampaign?.delayMinMs === "number" ? initialCampaign.delayMinMs : 0
  );
  const [delayMaxMs, setDelayMaxMs] = useState<number>(() =>
    typeof initialCampaign?.delayMaxMs === "number" ? initialCampaign.delayMaxMs : 2000
  );

  const [buttonUrl, setButtonUrl] = useState(() => {
    // A Next Post campaign created before this feature has no URL at all —
    // treat that as "auto-attach" rather than leaving a dead button.
    if (
      initialCampaign?.postScope === "NEXT_POST" &&
      !initialCampaign.buttonUrl?.trim()
    ) {
      return AUTO_REEL_LINK;
    }
    return initialCampaign?.buttonUrl ?? "https://dmplease.vercel.app/guide";
  });

  // Public Reply
  const [publicReplyEnabled, setPublicReplyEnabled] = useState(
    initialCampaign?.publicReplyEnabled ?? true
  );
  const [publicReplyMessages, setPublicReplyMessages] = useState<string[]>(() => {
    const existing = normalizePublicReplies(initialCampaign?.publicReplyMessages ?? []);
    return existing.length > 0 ? existing : [PUBLIC_REPLY_DEFAULT];
  });

  // Ask for Follow
  const [followGateEnabled, setFollowGateEnabled] = useState(
    initialCampaign?.followGateEnabled ?? false
  );
  const [openingMessage, setOpeningMessage] = useState(
    initialCampaign?.openingMessage ?? FOLLOW_GATE_DEFAULTS.openingMessage
  );
  const [followGateButtonLabel, setFollowGateButtonLabel] = useState(
    initialCampaign?.followGateButtonLabel ?? FOLLOW_GATE_DEFAULTS.buttonLabel
  );
  const [followGateOnUnavailable, setFollowGateOnUnavailable] =
    useState<FollowGateUnavailablePolicy>(
      initialCampaign?.followGateOnUnavailable === "deliver" ? "deliver" : "hold"
    );

  // Submitting state
  const [publishStatus, setPublishStatus] = useState<"idle" | "publishing" | "success">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  // Validation
  const isMissingPost = postScope === "SPECIFIC_POST" && !selectedPost;
  const canPublish =
    keywords.length > 0 &&
    dmMessage.trim().length > 0 &&
    !isMissingPost &&
    publishStatus === "idle";

  // Load the real account identity for the preview (avatar, blue tick, handle)
  useEffect(() => {
    let cancelled = false;
    fetch("/api/instagram/media")
      .then((res) => res.json())
      .then((json) => {
        if (cancelled || !json?.account) return;
        if (json.account.username) setInstagramHandle(json.account.username);
        setProfilePictureUrl(json.account.profilePictureUrl ?? null);
        setIsVerified(Boolean(json.account.isVerified));
        setFollowersCount(json.account.followersCount ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Load real media from Instagram when specific post is chosen
  useEffect(() => {
    async function fetchMedia() {
      setLoadingMedia(true);
      try {
        const res = await fetch("/api/instagram/media");
        const json = await res.json();
        if (json.account?.username) {
          setInstagramHandle(json.account.username);
        }
        if (json.success && json.media?.length > 0) {
          setMediaList(json.media);
          // When editing, keep the post this campaign is already attached to
          // and only enrich it with live media details.
          const existingMatch = (json.media as InstagramMediaItem[]).find(
            (item: InstagramMediaItem) => item.id === selectedPost?.id
          );
          if (existingMatch) {
            setSelectedPost(existingMatch);
          } else if (!selectedPost && json.media[0]) {
            setSelectedPost(json.media[0]);
          }
        }
      } catch (err) {
        console.error("Failed to load media:", err);
      } finally {
        setLoadingMedia(false);
      }
    }

    if (postScope === "SPECIFIC_POST" && mediaList.length === 0) {
      fetchMedia();
    }
  }, [postScope, mediaList.length, selectedPost]);

  const handleAddKeyword = (kw: string) => {
    const clean = kw.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "");
    if (clean && !keywords.includes(clean)) {
      setKeywords([...keywords, clean]);
      setKeywordInput("");
    }
  };

  const handleRemoveKeyword = (kw: string) => {
    setKeywords(keywords.filter((k) => k !== kw));
  };

  const applyRecipe = (recipe: typeof RECIPES[0]) => {
    setName(recipe.title);
    setKeywords([recipe.keyword]);
    setDmMessage(recipe.dm);
    setButtonText(recipe.buttonText);
    setButtonUrl(recipe.buttonUrl);
  };

  const handlePublish = async () => {
    if (isMissingPost) {
      setErrorMsg("Please select an Instagram reel below to attach to this automation.");
      return;
    }

    setPublishStatus("publishing");
    setErrorMsg(null);
    setFieldErrors({});

    const payload = {
      name: name.trim() || "Instagram Auto-DM Campaign",
      goal: "comment_to_dm",
      postScope,
      postId: selectedPost?.id,
      postThumbnailUrl: selectedPost?.thumbnailUrl,
      postCaption: selectedPost?.caption,
      triggerKeywords: keywords,
      dmMessage,
      dmVariants,
      messageFormat,
      messageAssets: {
        format: messageFormat,
        text: dmMessage,
        asset: messageAsset,
        cards,
      },
      shortLinksEnabled,
      linkRotatorId,
      hourlyCap,
      delayMinMs,
      delayMaxMs,
      buttonText,
      buttonUrl,
      publicReplyEnabled,
      publicReplyMessages: publicReplyEnabled ? publicReplyMessages : [],
      followGateEnabled,
      openingMessage: followGateEnabled ? openingMessage : null,
      followGateButtonLabel: followGateEnabled ? followGateButtonLabel : null,
      followGateOnUnavailable,
      collectField:
        collectField === "custom"
          ? collectCustomKey.trim()
            ? `custom:${collectCustomKey.trim()}`
            : "none"
          : collectField,
      collectRetryMessage: collectRetryMessage.trim() || null,
      collectSkipMessage: collectSkipMessage.trim() || null,
      collectSuccessMessage: collectSuccessMessage.trim() || null,
      collectSkipKeywords: collectSkipKeywords
        .split(",")
        .map((keyword) => keyword.trim())
        .filter(Boolean),
      collectMaxAttempts,
    };

    try {
      const res =
        isEdit && initialCampaign
          ? await updateCampaign(initialCampaign.id, payload)
          : await createCampaign(payload);

      if (res.success) {
        posthog.capture(isEdit ? "campaign_updated" : "campaign_published", {
          post_scope: postScope,
          keyword_count: keywords.length,
          public_reply_enabled: publicReplyEnabled,
          public_reply_variants: publicReplyEnabled ? publicReplyMessages.length : 0,
          follow_gate_enabled: followGateEnabled,
          follow_gate_on_unavailable: followGateOnUnavailable,
          collect_field: collectField,
          dm_variants: dmVariants.length,
          message_format: messageFormat,
          short_links_enabled: shortLinksEnabled,
          link_rotator: linkRotatorId ? "rotation" : "single",
          has_action_button: Boolean(buttonText.trim() && buttonUrl.trim()),
        });
        setPublishStatus("success");
        setTimeout(() => {
          router.push(
            isEdit
              ? "/dashboard/campaigns?saved=1"
              : "/dashboard/campaigns?created=1"
          );
          router.refresh();
        }, 500);
      } else {
        setPublishStatus("idle");
        setErrorMsg(res.error || "Failed to publish campaign");
        setFieldErrors(
          (res as { fieldErrors?: Record<string, string[]> }).fieldErrors ?? {}
        );
      }
    } catch {
      setPublishStatus("idle");
      setErrorMsg("An unexpected error occurred while publishing.");
    }
  };

  return (
    <div className="space-y-6 antialiased selection:bg-[#ffd02f] selection:text-[#1c1c1e]">
      {/* ── Top Bar ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-[#e0e2e8] dark:border-border/80">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="size-8 rounded-full text-muted-foreground hover:text-foreground">
            <Link href="/dashboard/campaigns">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="font-semibold text-base sm:text-lg tracking-tight bg-transparent border-transparent hover:border-[#c7cad5] focus:border-[#4262ff] h-8 px-2 rounded-lg w-64 sm:w-80"
              />
            </div>
            <p className="text-xs text-[#555a6a] dark:text-muted-foreground px-2 font-medium text-[11px]">
              Turn comments into automated direct messages
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            asChild
            className="rounded-full text-xs font-medium h-9 px-4 border-[#c7cad5]"
          >
            <Link href="/dashboard/campaigns">
              {isEdit ? "Cancel" : "Discard"}
            </Link>
          </Button>
          
          <Button
            size="sm"
            disabled={!canPublish}
            onClick={handlePublish}
            className={`rounded-full text-xs font-semibold h-9 min-w-[170px] px-5 transition-all shadow-xs flex items-center justify-center gap-2 ${
              publishStatus === "success"
                ? "bg-[#00b473] text-white"
                : "bg-[#1c1c1e] hover:bg-[#2c2c34] text-white dark:bg-[#ffd02f] dark:text-[#1c1c1e] dark:hover:bg-[#fcb900]"
            }`}
          >
            {publishStatus === "publishing" && (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                <span>{isEdit ? "Saving..." : "Launching..."}</span>
              </>
            )}
            {publishStatus === "success" && (
              <>
                <Check className="size-4 stroke-[3]" />
                <span>{isEdit ? "Saved! Redirecting..." : "Published! Redirecting..."}</span>
              </>
            )}
            {publishStatus === "idle" && (
              <span>
                {isMissingPost && !isEdit
                  ? "Pick a Reel to Launch"
                  : isEdit
                    ? "Save Changes 🚀"
                    : "Launch Automation 🚀"}
              </span>
            )}
          </Button>
        </div>
      </div>

      <div className="flex items-start gap-2.5 rounded-2xl border border-[#e0e2e8] dark:border-border/80 bg-[#f7f8fa] dark:bg-muted/30 px-4 py-3 text-xs text-[#555a6a] dark:text-muted-foreground">
        <Sparkles className="size-4 mt-0.5 text-[#ffd02f] shrink-0" aria-hidden="true" />
        <p className="leading-relaxed">
          <span className="font-semibold text-foreground">New here?</span> Choose where the trigger applies, add a keyword, write your DM, then launch.
          You can change every setting later.
        </p>
      </div>

      {errorMsg && (
        <div role="alert" aria-live="assertive" className="p-3.5 rounded-2xl border border-destructive/40 bg-destructive/10 text-xs font-medium text-destructive flex flex-col gap-1.5">
          <span className="flex items-center gap-2">
            <X className="size-4 shrink-0" aria-hidden="true" />
            {errorMsg}
          </span>
          {Object.entries(fieldErrors).map(([field, messages]) => (
            <span key={field} className="pl-6 text-[11px] font-normal opacity-90">
              {field}: {messages.join(", ")}
            </span>
          ))}
        </div>
      )}

      {/* ── Quick Recipe Pills ── */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
        <span className="text-[#6b6f7e] font-semibold text-[11px] uppercase flex items-center gap-1 shrink-0">
          <Sparkles className="size-3 text-[#ffd02f]" /> Quick Recipes:
        </span>
        {RECIPES.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => applyRecipe(r)}
            className="px-3 py-1 rounded-full border border-[#e0e2e8] dark:border-border/80 bg-[#f7f8fa] dark:bg-muted/40 hover:bg-[#eef0f3] text-foreground text-xs font-medium shrink-0 transition-colors"
          >
            {r.title}
          </button>
        ))}
      </div>

      {/* ── Main Split Screen (Controls on Left, Live Preview on Right) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Configuration */}
        <div className="lg:col-span-7 space-y-4">
          
          {/* STEP 1: Select Target Post */}
          <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 p-5 shadow-subtle space-y-3.5">
            <div>
              <h3 className="font-semibold text-sm text-foreground flex items-center gap-2">
                <span className="size-5 rounded-full bg-[#1c1c1e] text-white dark:bg-white dark:text-[#1c1c1e] flex items-center justify-center text-[10px] font-bold">
                  1
                </span>
                Target Content Scope
              </h3>
              <p className="text-xs text-[#555a6a] dark:text-muted-foreground mt-0.5">
                Which Instagram content will trigger this automation?
              </p>
            </div>

            {/* Scope Pills */}
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => {
                  setPostScope("ANY_POST");
                  if (isAutoReelLink(buttonUrl)) setButtonUrl("https://dmplease.vercel.app/guide");
                }}
                className={`p-3 rounded-2xl border text-xs font-medium transition-all text-center ${
                  postScope === "ANY_POST"
                    ? "border-[#4262ff] bg-[#f5f3ff] text-[#4262ff] dark:bg-[#4262ff]/10 dark:text-[#8b9eff]"
                    : "border-[#e0e2e8] dark:border-border hover:bg-[#f7f8fa] text-muted-foreground"
                }`}
              >
                <p className="font-semibold text-xs text-foreground">Any Post / Reel</p>
                <p className="text-[10px] text-[#555a6a] dark:text-muted-foreground mt-0.5">Recommended</p>
              </button>

              <button
                type="button"
                onClick={() => {
                  setPostScope("SPECIFIC_POST");
                  if (isAutoReelLink(buttonUrl)) setButtonUrl("https://dmplease.vercel.app/guide");
                }}
                className={`p-3 rounded-2xl border text-xs font-medium transition-all text-center ${
                  postScope === "SPECIFIC_POST"
                    ? "border-[#4262ff] bg-[#f5f3ff] text-[#4262ff] dark:bg-[#4262ff]/10 dark:text-[#8b9eff]"
                    : "border-[#e0e2e8] dark:border-border hover:bg-[#f7f8fa] text-muted-foreground"
                }`}
              >
                <p className="font-semibold text-xs text-foreground">Specific Reel</p>
                <p className="text-[10px] text-[#555a6a] dark:text-muted-foreground mt-0.5">Select from account</p>
              </button>

              <button
                type="button"
                onClick={() => {
                  setPostScope("NEXT_POST");
                  if (!isAutoReelLink(buttonUrl)) setButtonUrl(AUTO_REEL_LINK);
                }}
                className={`p-3 rounded-2xl border text-xs font-medium transition-all text-center ${
                  postScope === "NEXT_POST"
                    ? "border-[#4262ff] bg-[#f5f3ff] text-[#4262ff] dark:bg-[#4262ff]/10 dark:text-[#8b9eff]"
                    : "border-[#e0e2e8] dark:border-border hover:bg-[#f7f8fa] text-muted-foreground"
                }`}
              >
                <p className="font-semibold text-xs text-foreground">Next Post</p>
                <p className="text-[10px] text-[#555a6a] dark:text-muted-foreground mt-0.5">Auto-attaches</p>
              </button>
            </div>

            {postScope === "NEXT_POST" && (
              <div className="flex items-start gap-2 rounded-xl border border-[#4262ff]/30 bg-[#f5f3ff] dark:bg-[#4262ff]/10 px-3 py-2.5 text-[11px] leading-relaxed text-[#555a6a] dark:text-muted-foreground">
                <Instagram className="size-3.5 mt-0.5 text-[#4262ff] shrink-0" aria-hidden="true" />
                <p>
                  <span className="font-semibold text-foreground">No URL needed.</span>{" "}
                  When someone comments on your next upload, dmplease resolves that reel&apos;s
                  real permalink and attaches it to the DM automatically.
                </p>
              </div>
            )}

            {/* Real Instagram Media Picker */}
            {postScope === "SPECIFIC_POST" && (
              <div className="space-y-3 pt-2 border-t border-[#e0e2e8] dark:border-border/60">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-foreground flex items-center gap-1.5">
                    <Instagram className="size-3.5 text-rose-500" />
                    {instagramHandle !== "yourbrand"
                      ? `Reels from @${instagramHandle}:`
                      : "Instagram Reels:"}
                  </span>
                  {loadingMedia && (
                    <span className="text-[11px] text-[#555a6a] animate-pulse flex items-center gap-1 font-mono">
                      <Loader2 className="size-3 animate-spin" /> Loading reels...
                    </span>
                  )}
                </div>

                {selectedPost && (
                  <div className="p-3 rounded-xl bg-[#f7f8fa] dark:bg-muted/40 border border-[#e0e2e8] dark:border-border flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={selectedPost.thumbnailUrl}
                      alt={selectedPost.caption || "Selected Reel"}
                      className="size-11 rounded-lg object-cover border border-[#e0e2e8] shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                        <span className="size-1.5 rounded-full bg-[#00b473]" />
                        Target Reel Selected
                      </div>
                      <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground truncate mt-0.5">
                        {selectedPost.caption || "Instagram Reel"}
                      </p>
                    </div>
                    <Badge variant="tag-teal" className="text-[10px] shrink-0 py-0.5 px-2.5">
                      Attached
                    </Badge>
                  </div>
                )}

                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5 max-h-52 overflow-y-auto p-1">
                  {mediaList.map((media) => {
                    const isSelected = selectedPost?.id === media.id;
                    return (
                      <div
                        key={media.id}
                        onClick={() => setSelectedPost(media)}
                        className={`group relative aspect-square rounded-xl overflow-hidden cursor-pointer border-2 transition-all ${
                          isSelected
                            ? "border-[#4262ff] scale-[1.02] shadow-sm"
                            : "border-transparent opacity-80 hover:opacity-100"
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={media.thumbnailUrl}
                          alt={media.caption || "Reel"}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        />
                        {isSelected && (
                          <div className="absolute top-1.5 right-1.5 size-4 rounded-full bg-[#4262ff] text-white flex items-center justify-center shadow-md">
                            <Check className="size-3 stroke-[3]" />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end p-1.5">
                          <span className="text-[10px] text-white line-clamp-1 font-sans">
                            {media.caption || "Reel"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Card>

          {/* STEP 2: Trigger Keywords */}
          <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 p-5 shadow-subtle space-y-3.5">
            <div>
              <h3 className="font-semibold text-sm text-foreground flex items-center gap-2">
                <span className="size-5 rounded-full bg-[#1c1c1c] text-white dark:bg-white dark:text-[#1c1c1e] flex items-center justify-center text-[10px] font-bold">
                  2
                </span>
                Keyword Trigger Pattern
              </h3>
              <p className="text-xs text-[#555a6a] dark:text-muted-foreground mt-0.5">
                The word or phrase followers comment on your post to activate the automation.
              </p>
            </div>

            {/* Keyword Chips & Input */}
            <div className="p-3 rounded-xl border border-[#c7cad5] dark:border-border bg-background flex flex-wrap items-center gap-2">
              {keywords.map((kw) => (
                <span
                  key={kw}
                  className="px-3 py-1 rounded-full bg-[#1c1c1e] text-white font-mono font-medium text-xs flex items-center gap-1.5 shadow-xs dark:bg-white dark:text-[#1c1c1e]"
                >
                  {kw}
                  <button
                    type="button"
                    onClick={() => handleRemoveKeyword(kw)}
                    className="hover:opacity-75 text-neutral-400 hover:text-white dark:text-neutral-600 dark:hover:text-black"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}

              <input
                placeholder={keywords.length === 0 ? "Type keyword (e.g. GUIDE) & press Enter..." : "Add another..."}
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    handleAddKeyword(keywordInput);
                  }
                }}
                className="flex-1 min-w-[140px] text-xs font-mono bg-transparent outline-none placeholder:text-muted-foreground/70"
              />
            </div>

            {/* Popular suggestions */}
            <div className="flex items-center gap-1.5 flex-wrap text-xs">
              <span className="text-[11px] text-[#6b6f7e] font-semibold">Suggestions:</span>
              {POPULAR_KEYWORD_PILLS.map((pill) => (
                <button
                  key={pill}
                  type="button"
                  onClick={() => handleAddKeyword(pill)}
                  className="px-2.5 py-0.5 rounded-full border border-[#e0e2e8] dark:border-border/80 hover:bg-[#f7f8fa] text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors"
                >
                  + {pill}
                </button>
              ))}
            </div>
          </Card>

          {/* STEP 3: Automated Direct Message */}
          <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 p-5 shadow-subtle space-y-3.5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-sm text-foreground flex items-center gap-2">
                  <span className="size-5 rounded-full bg-[#1c1c1c] text-white dark:bg-white dark:text-[#1c1c1e] flex items-center justify-center text-[10px] font-bold">
                    3
                  </span>
                  Automated Direct Message Payload
                </h3>
                <p className="text-xs text-[#555a6a] dark:text-muted-foreground mt-0.5">
                  Delivered instantly to the commenter&apos;s Instagram inbox via Meta Send API.
                </p>
              </div>
              <span className="text-[11px] text-[#6b6f7e] font-mono">
                {dmMessage.length}/1000
              </span>
            </div>

            <DmVariablePicker
              textareaId="campaign-dm-message"
              value={dmMessage}
              onChange={setDmMessage}
              uncollectedVariables={
                collectField === "none"
                  ? (findDmVariables(dmMessage).filter((token) =>
                      (CONTACT_TOKENS as readonly string[]).includes(token)
                    ) as (typeof CONTACT_TOKENS)[number][])
                  : []
              }
              disabled={publishStatus === "publishing"}
            />

            <label htmlFor="campaign-dm-message" className="sr-only">
              Direct message text
            </label>
            <textarea
              id="campaign-dm-message"
              rows={3}
              value={dmMessage}
              onChange={(e) => setDmMessage(e.target.value)}
              aria-describedby="campaign-dm-help"
              className="w-full p-3.5 rounded-xl border border-[#c7cad5] dark:border-border bg-background text-xs sm:text-sm font-sans focus:border-[#4262ff] focus:ring-2 focus:ring-[#4262ff]/20 outline-none resize-none leading-relaxed transition-all"
            />
            <p id="campaign-dm-help" className="sr-only">
              Use the buttons above to insert personalisation variables at the cursor.
            </p>

            {/* Interactive Link Button */}
            <div className="pt-2 border-t border-[#e0e2e8] dark:border-border/60 space-y-3">
              <Label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <ExternalLink className="size-3.5 text-[#4262ff]" />
                Interactive Action Button in DM
              </Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <span className="text-[11px] text-[#6b6f7e] font-medium">Button Title</span>
                  <Input
                    placeholder="Download Guide 📖"
                    value={buttonText}
                    onChange={(e) => setButtonText(e.target.value)}
                    className="h-9 text-xs rounded-lg"
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-[11px] text-[#6b6f7e] font-medium">Destination URL</span>
                  {postScope === "NEXT_POST" && isAutoReelLink(buttonUrl) ? (
                    <div className="flex items-center justify-between gap-2 h-9 px-3 rounded-lg border border-[#4262ff]/30 bg-[#f5f3ff] dark:bg-[#4262ff]/10 text-xs text-foreground">
                      <span className="truncate">Auto — new reel permalink</span>
                      <button
                        type="button"
                        onClick={() => setButtonUrl("https://dmplease.vercel.app/guide")}
                        className="text-[10px] font-semibold text-[#4262ff] hover:underline shrink-0"
                      >
                        Use custom URL
                      </button>
                    </div>
                  ) : (
                    <Input
                      placeholder="https://yourwebsite.com/guide"
                      value={buttonUrl}
                      onChange={(e) => setButtonUrl(e.target.value)}
                      className="h-9 text-xs rounded-lg"
                    />
                  )}
                </div>
              </div>
            </div>
          </Card>

          <LinkRotationSettings
            enabled={shortLinksEnabled}
            onEnabledChange={setShortLinksEnabled}
            rotators={linkRotators}
            rotatorId={linkRotatorId}
            onRotatorIdChange={setLinkRotatorId}
            disabled={publishStatus === "publishing"}
          />

          <MessageFormatEditor
            format={messageFormat}
            onFormatChange={setMessageFormat}
            asset={messageAsset}
            onAssetChange={setMessageAsset}
            cards={cards}
            onCardsChange={setCards}
            disabled={publishStatus === "publishing"}
          />

          <DmVariantsEditor
            primaryMessage={dmMessage}
            variants={dmVariants}
            onVariantsChange={setDmVariants}
            disabled={publishStatus === "publishing"}
          />

          {/* STEP 3: Collect info (lead capture) */}
          <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 p-5 shadow-subtle space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-0.5">
                <h3 className="font-semibold text-xs sm:text-sm text-foreground flex items-center gap-2">
                  <UserPlus className="size-4 text-[#4262ff]" aria-hidden="true" />
                  Collect info
                </h3>
                <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground">
                  Ask one question after the DM, validate the reply, and save it to the
                  contact. Use it later with{" "}
                  <code className="font-mono">{"{name}"}</code>,{" "}
                  <code className="font-mono">{"{email}"}</code> or{" "}
                  <code className="font-mono">{"{phone}"}</code>.
                </p>
              </div>
              <Badge variant="outline" className="text-[10px] rounded-full shrink-0">
                Optional
              </Badge>
            </div>

            <div className="space-y-1">
              <Label htmlFor="campaign-collect-field" className="text-[11px]">
                What should we ask for?
              </Label>
              <select
                id="campaign-collect-field"
                value={collectField}
                onChange={(event) => setCollectField(event.target.value)}
                disabled={publishStatus === "publishing"}
                className="h-9 w-full rounded-lg border border-[#c7cad5] dark:border-border bg-background px-3 text-xs outline-none focus:border-[#4262ff] focus:ring-2 focus:ring-[#4262ff]/20"
              >
                <option value="none">Nothing — just send the DM</option>
                <option value="name">Their name</option>
                <option value="email">Their email address</option>
                <option value="phone">Their phone number</option>
                <option value="custom">A custom property</option>
              </select>
            </div>

            {collectField === "custom" && (
              <div className="space-y-1">
                <Label htmlFor="campaign-collect-key" className="text-[11px]">
                  Property name
                </Label>
                <Input
                  id="campaign-collect-key"
                  value={collectCustomKey}
                  onChange={(event) => setCollectCustomKey(event.target.value)}
                  placeholder="e.g. company, city, budget"
                  disabled={publishStatus === "publishing"}
                  className="h-9 text-xs"
                />
                <p className="text-[10px] text-muted-foreground">
                  Saved under this key on the contact&apos;s custom properties.
                </p>
              </div>
            )}

            {collectField !== "none" && (
              <div className="space-y-3 rounded-xl border border-[#e0e2e8] dark:border-border p-3.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6b6f7e]">
                  Conversation copy
                </p>
                <div className="space-y-1">
                  <Label htmlFor="campaign-collect-retry" className="text-[11px]">
                    Retry message (invalid reply)
                  </Label>
                  <textarea
                    id="campaign-collect-retry"
                    rows={2}
                    value={collectRetryMessage}
                    onChange={(event) => setCollectRetryMessage(event.target.value)}
                    placeholder="That doesn't look quite right. Please try again, or reply SKIP to continue."
                    disabled={publishStatus === "publishing"}
                    className="w-full rounded-xl border border-[#c7cad5] dark:border-border bg-background px-3.5 py-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 resize-none"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="campaign-collect-skip" className="text-[11px]">
                    Skip message
                  </Label>
                  <textarea
                    id="campaign-collect-skip"
                    rows={2}
                    value={collectSkipMessage}
                    onChange={(event) => setCollectSkipMessage(event.target.value)}
                    placeholder="No problem — I'll skip that. Here's everything else you need."
                    disabled={publishStatus === "publishing"}
                    className="w-full rounded-xl border border-[#c7cad5] dark:border-border bg-background px-3.5 py-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 resize-none"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="campaign-collect-success" className="text-[11px]">
                    Success message
                  </Label>
                  <textarea
                    id="campaign-collect-success"
                    rows={2}
                    value={collectSuccessMessage}
                    onChange={(event) => setCollectSuccessMessage(event.target.value)}
                    placeholder="Got it, thank you! ✅"
                    disabled={publishStatus === "publishing"}
                    className="w-full rounded-xl border border-[#c7cad5] dark:border-border bg-background px-3.5 py-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 resize-none"
                  />
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="campaign-collect-keywords" className="text-[11px]">
                      Skip keywords
                    </Label>
                    <Input
                      id="campaign-collect-keywords"
                      value={collectSkipKeywords}
                      onChange={(event) => setCollectSkipKeywords(event.target.value)}
                      placeholder="skip, later, no thanks"
                      disabled={publishStatus === "publishing"}
                      className="h-9 text-xs"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Comma-separated. A reply matching one skips the step.
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="campaign-collect-attempts" className="text-[11px]">
                      Max attempts
                    </Label>
                    <Input
                      id="campaign-collect-attempts"
                      type="number"
                      min={1}
                      max={10}
                      value={collectMaxAttempts}
                      onChange={(event) => setCollectMaxAttempts(Number(event.target.value))}
                      disabled={publishStatus === "publishing"}
                      className="h-9 text-xs"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      After this many invalid replies we send the skip message.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <ol className="space-y-1.5 text-[11px] text-[#555a6a] dark:text-muted-foreground">
              <li className="flex gap-2">
                <span className="font-mono text-[10px] text-[#4262ff]">1</span>
                Follower comments your keyword and gets the DM.
              </li>
              <li className="flex gap-2">
                <span className="font-mono text-[10px] text-[#4262ff]">2</span>
                We ask for the detail and validate the reply.
              </li>
              <li className="flex gap-2">
                <span className="font-mono text-[10px] text-[#4262ff]">3</span>
                The contact is saved and appears in Contacts.
              </li>
            </ol>
          </Card>

          {/* STEP 4: Optional Public Comment Reply */}
          <PublicReplySettings
            enabled={publicReplyEnabled}
            onEnabledChange={setPublicReplyEnabled}
            messages={publicReplyMessages}
            onMessagesChange={setPublicReplyMessages}
            errors={fieldErrors.publicReplyMessages}
            disabled={publishStatus === "publishing"}
          />

          {/* STEP 5: Ask for Follow */}
          <FollowGateSettings
            mode="comment"
            enabled={followGateEnabled}
            onEnabledChange={setFollowGateEnabled}
            openingMessage={openingMessage}
            onOpeningMessageChange={setOpeningMessage}
            buttonLabel={followGateButtonLabel}
            onButtonLabelChange={setFollowGateButtonLabel}
            onUnavailable={followGateOnUnavailable}
            onUnavailableChange={setFollowGateOnUnavailable}
            fieldErrors={fieldErrors}
            disabled={publishStatus === "publishing"}
          />

          {/* Safety & delivery */}
          <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 p-5 shadow-subtle space-y-4">
            <div>
              <h3 className="font-semibold text-sm text-foreground">Safety &amp; delivery</h3>
              <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground mt-0.5">
                Caps and randomized delays keep you under Meta&apos;s limits during a viral spike.
              </p>
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="hourlyCap" className="text-[11px]">Hourly cap</Label>
                <Input
                  id="hourlyCap"
                  type="number"
                  min={0}
                  max={10000}
                  value={hourlyCap}
                  onChange={(e) => setHourlyCap(Number(e.target.value))}
                  disabled={publishStatus === "publishing"}
                  className="h-8 text-xs"
                />
                <p className="text-[10px] text-muted-foreground">0 = unlimited. The 101st DM is queued.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="delayMinMs" className="text-[11px]">Delay min (ms)</Label>
                <Input
                  id="delayMinMs"
                  type="number"
                  min={0}
                  max={60000}
                  value={delayMinMs}
                  onChange={(e) => setDelayMinMs(Number(e.target.value))}
                  disabled={publishStatus === "publishing"}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="delayMaxMs" className="text-[11px]">Delay max (ms)</Label>
                <Input
                  id="delayMaxMs"
                  type="number"
                  min={0}
                  max={60000}
                  value={delayMaxMs}
                  onChange={(e) => setDelayMaxMs(Number(e.target.value))}
                  disabled={publishStatus === "publishing"}
                  className="h-8 text-xs"
                />
                <p className="text-[10px] text-muted-foreground">Randomized 0–50s keeps bursts low.</p>
              </div>
            </div>
          </Card>

          {/* STEP 6: Follow-ups (configured after the campaign exists) */}
          <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 p-4 shadow-subtle">
            <div className="flex items-start gap-3">
              <Clock className="size-4 mt-0.5 text-[#4262ff] shrink-0" aria-hidden="true" />
              <div className="space-y-1">
                <h3 className="font-semibold text-xs text-foreground">24h follow-ups</h3>
                <p className="text-[11px] leading-relaxed text-[#555a6a] dark:text-muted-foreground">
                  Send a friendly reminder after someone opts in. The sequence stops
                  automatically if they click, reply or convert.{" "}
                  {isEdit ? (
                    <a
                      href="#followups"
                      className="font-semibold text-[#4262ff] hover:underline"
                    >
                      Manage follow-up steps →
                    </a>
                  ) : (
                    "You can add steps right after publishing."
                  )}
                </p>
              </div>
            </div>
          </Card>
        </div>

        {/* Right Column: Phone Simulator */}
        <div className="lg:col-span-5 sticky top-20 flex justify-center">
          <PhonePreview
            postScope={postScope}
            postThumbnailUrl={selectedPost?.thumbnailUrl}
            postCaption={selectedPost?.caption}
            triggerKeyword={keywords[0] || "GUIDE"}
            dmMessage={dmMessage}
            dmVariantCount={dmVariants.length}
            messageFormat={messageFormat}
            messageAsset={messageAsset}
            cards={cards}
            shortLinksEnabled={shortLinksEnabled}
            buttonText={buttonText}
            buttonUrl={
              isAutoReelLink(buttonUrl)
                ? "https://instagram.com/reel/your-next-reel"
                : buttonUrl
            }
            publicReplyEnabled={publicReplyEnabled}
            publicReplyMessages={publicReplyMessages}
            followGateEnabled={followGateEnabled}
            followGateOpeningMessage={openingMessage}
            followGateButtonLabel={followGateButtonLabel}
            collectField={
              collectField === "custom"
                ? collectCustomKey.trim()
                  ? `custom:${collectCustomKey.trim()}`
                  : "none"
                : collectField
            }
            collectRetryMessage={collectRetryMessage}
            collectSkipMessage={collectSkipMessage}
            collectSuccessMessage={collectSuccessMessage}
            collectSkipKeywords={collectSkipKeywords
              .split(",")
              .map((keyword) => keyword.trim())
              .filter(Boolean)}
            instagramHandle={instagramHandle}
            profilePictureUrl={profilePictureUrl}
            isVerified={isVerified}
            followersCount={followersCount}
          />
        </div>
      </div>
    </div>
  );
}
