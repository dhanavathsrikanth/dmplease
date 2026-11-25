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
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PhonePreview } from "@/components/campaigns/phone-preview";
import { createCampaign } from "@/app/dashboard/campaigns/actions";

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
    dm: "Hey {username}! Here is your free training guide: https://trydmplease.com/guide. Enjoy! 🙌",
    buttonText: "Download Guide 📖",
    buttonUrl: "https://trydmplease.com/guide",
  },
  {
    id: "discount",
    title: "VIP Promo / Discount",
    keyword: "VIP",
    dm: "Here's your 20% off VIP code: VIP20. Shop our store here: https://trydmplease.com/shop 🛍️",
    buttonText: "Shop With 20% Off 🛍️",
    buttonUrl: "https://trydmplease.com/shop",
  },
  {
    id: "booking",
    title: "Discovery Call Booking",
    keyword: "CALL",
    dm: "Would love to chat with you {username}! Pick a time on my calendar here: https://calendly.com/your-call 📅",
    buttonText: "Book Discovery Call 📅",
    buttonUrl: "https://calendly.com/your-call",
  },
];

interface CampaignBuilderProps {
  initialHandle?: string;
}

export function CampaignBuilder({ initialHandle }: CampaignBuilderProps = {}) {
  const router = useRouter();

  const [instagramHandle, setInstagramHandle] = useState(initialHandle || "yourbrand");

  // Campaign State
  const [name, setName] = useState("Instagram Auto-DM Campaign");
  const [postScope, setPostScope] = useState<"ANY_POST" | "SPECIFIC_POST" | "NEXT_POST">("ANY_POST");
  const [selectedPost, setSelectedPost] = useState<InstagramMediaItem | null>(null);

  // Live media from Instagram
  const [mediaList, setMediaList] = useState<InstagramMediaItem[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(false);

  // Triggers
  const [keywords, setKeywords] = useState<string[]>(["GUIDE"]);
  const [keywordInput, setKeywordInput] = useState("");

  // DM Message & Action Button
  const [dmMessage, setDmMessage] = useState(
    "Hey {username}! Thanks for your comment. Here is your free guide: {link}. Enjoy! 🙌"
  );
  const [buttonText, setButtonText] = useState("Download Guide 📖");
  const [buttonUrl, setButtonUrl] = useState("https://trydmplease.com/guide");

  // Public Reply
  const [publicReplyEnabled, setPublicReplyEnabled] = useState(true);
  const [publicReplyMessage, setPublicReplyMessage] = useState("Sent you a DM! 📩");

  // Follow-gate
  const [followGateEnabled, setFollowGateEnabled] = useState(false);

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
          if (!selectedPost && json.media[0]) {
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
      buttonText,
      buttonUrl,
      publicReplyEnabled,
      publicReplyMessages: publicReplyEnabled ? [publicReplyMessage] : [],
      followGateEnabled,
    };

    try {
      const res = await createCampaign(payload);

      if (res.success) {
        posthog.capture("campaign_published", {
          post_scope: postScope,
          keyword_count: keywords.length,
          public_reply_enabled: publicReplyEnabled,
          follow_gate_enabled: followGateEnabled,
          has_action_button: Boolean(buttonText.trim() && buttonUrl.trim()),
        });
        setPublishStatus("success");
        setTimeout(() => {
          router.push("/dashboard/campaigns?created=1");
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
            <Link href="/dashboard/campaigns">Discard</Link>
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
                <span>Launching...</span>
              </>
            )}
            {publishStatus === "success" && (
              <>
                <Check className="size-4 stroke-[3]" />
                <span>Published! Redirecting...</span>
              </>
            )}
            {publishStatus === "idle" && (
              <span>
                {isMissingPost ? "Pick a Reel to Launch" : "Launch Automation 🚀"}
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
                onClick={() => setPostScope("ANY_POST")}
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
                onClick={() => setPostScope("SPECIFIC_POST")}
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
                onClick={() => setPostScope("NEXT_POST")}
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

            {/* Variable Pills with Tooltips */}
            <TooltipProvider delayDuration={200}>
              <div className="flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setDmMessage((prev) => `${prev} {username}`)}
                      className="px-3 py-1 rounded-full border border-[#e0e2e8] dark:border-border/80 bg-[#f7f8fa] dark:bg-muted/30 hover:bg-[#eef0f3] text-xs font-mono text-foreground transition-colors"
                    >
                      + &#123;username&#125;
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Inserts recipient&apos;s Instagram username</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setDmMessage((prev) => `${prev} {link}`)}
                      className="px-3 py-1 rounded-full border border-[#e0e2e8] dark:border-border/80 bg-[#f7f8fa] dark:bg-muted/30 hover:bg-[#eef0f3] text-xs font-mono text-foreground transition-colors"
                    >
                      + &#123;link&#125;
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Inserts the destination action URL</TooltipContent>
                </Tooltip>
              </div>
            </TooltipProvider>

            <textarea
              rows={3}
              value={dmMessage}
              onChange={(e) => setDmMessage(e.target.value)}
              className="w-full p-3.5 rounded-xl border border-[#c7cad5] dark:border-border bg-background text-xs sm:text-sm font-sans focus:border-[#4262ff] focus:ring-2 focus:ring-[#4262ff]/20 outline-none resize-none leading-relaxed transition-all"
            />

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
                  <Input
                    placeholder="https://yourwebsite.com/guide"
                    value={buttonUrl}
                    onChange={(e) => setButtonUrl(e.target.value)}
                    className="h-9 text-xs rounded-lg"
                  />
                </div>
              </div>
            </div>
          </Card>

          {/* STEP 4: Optional Public Comment Reply */}
          <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 p-5 shadow-subtle space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-semibold text-xs sm:text-sm text-foreground">
                  Public Comment Reply
                </h4>
                <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground mt-0.5">
                  Replies publicly to the commenter so other followers notice the automation
                </p>
              </div>
              <Switch
                checked={publicReplyEnabled}
                onCheckedChange={setPublicReplyEnabled}
              />
            </div>

            {publicReplyEnabled && (
              <Input
                value={publicReplyMessage}
                onChange={(e) => setPublicReplyMessage(e.target.value)}
                placeholder="Sent you a DM! 📩"
                className="h-9 text-xs rounded-lg bg-[#f7f8fa] dark:bg-muted/40"
              />
            )}
          </Card>

          {/* STEP 5: Optional Follow Gate */}
          <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 p-5 shadow-subtle space-y-2">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h4 className="font-semibold text-xs sm:text-sm text-foreground">
                  Ask followers to follow first
                </h4>
                <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground mt-0.5">
                  Only people who follow your account receive the DM. Others are skipped.
                </p>
              </div>
              <Switch
                checked={followGateEnabled}
                onCheckedChange={setFollowGateEnabled}
                aria-label="Require followers before sending the DM"
              />
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
            buttonText={buttonText}
            buttonUrl={buttonUrl}
            publicReplyEnabled={publicReplyEnabled}
            publicReplyMessage={publicReplyMessage}
            instagramHandle={instagramHandle}
          />
        </div>
      </div>
    </div>
  );
}
