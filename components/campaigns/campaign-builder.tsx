"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  ArrowLeft,
  X,
  Instagram,
  Check,
  ExternalLink,
  Loader2,
  Film,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
        setPublishStatus("success");
        setTimeout(() => {
          router.push("/dashboard/campaigns");
          router.refresh();
        }, 500);
      } else {
        setPublishStatus("idle");
        setErrorMsg(res.error || "Failed to publish campaign");
      }
    } catch {
      setPublishStatus("idle");
      setErrorMsg("An unexpected error occurred while publishing.");
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Top Bar ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border/80">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="size-8 rounded-xl text-muted-foreground hover:text-foreground">
            <Link href="/dashboard/campaigns">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="font-bold text-lg sm:text-xl tracking-tight bg-transparent border-transparent hover:border-border focus:border-border h-9 px-1 rounded-lg w-72 sm:w-96"
              />
            </div>
            <p className="text-xs text-muted-foreground px-1">
              Turn comments into automated direct messages
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            asChild
            className="rounded-xl text-xs font-semibold h-9"
          >
            <Link href="/dashboard/campaigns">Discard</Link>
          </Button>
          
          <Button
            size="sm"
            disabled={!canPublish}
            onClick={handlePublish}
            className={`rounded-xl text-xs font-semibold h-9 min-w-[195px] px-5 transition-all shadow-sm flex items-center justify-center gap-2 ${
              publishStatus === "success"
                ? "bg-emerald-600 hover:bg-emerald-600 text-white"
                : "bg-neutral-900 hover:bg-neutral-800 text-white dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100"
            }`}
          >
            {publishStatus === "publishing" && (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                <span>Launching Automation...</span>
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

      {errorMsg && (
        <div className="p-3.5 rounded-xl border border-destructive/40 bg-destructive/10 text-xs font-medium text-destructive flex items-center gap-2">
          <X className="size-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* ── Quick Recipe Pills ── */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
        <span className="text-muted-foreground font-semibold flex items-center gap-1 shrink-0">
          <Sparkles className="size-3.5 text-lime-500" /> Quick Recipes:
        </span>
        {RECIPES.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => applyRecipe(r)}
            className="px-3 py-1 rounded-full border border-border/80 bg-muted/30 hover:bg-muted text-foreground font-medium shrink-0 transition-colors"
          >
            {r.title}
          </button>
        ))}
      </div>

      {/* ── Main Split Screen (Controls on Left, Live Preview on Right) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Frictionless Configuration */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* STEP 1: Select Target Post */}
          <Card className="rounded-2xl border-border/80 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-foreground flex items-center gap-2">
                  <span className="size-5 rounded-full bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 flex items-center justify-center text-[11px]">
                    1
                  </span>
                  Choose Target Content
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Which Instagram posts will trigger this automation?
                </p>
              </div>
            </div>

            {/* Scope Pills */}
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setPostScope("ANY_POST")}
                className={`p-3 rounded-xl border text-xs font-semibold transition-all text-center ${
                  postScope === "ANY_POST"
                    ? "border-neutral-900 dark:border-white bg-neutral-50 dark:bg-neutral-800 ring-1 ring-neutral-900 dark:ring-white"
                    : "border-border hover:bg-muted/40"
                }`}
              >
                <p className="font-bold">Any Post / Reel</p>
                <p className="text-[10px] text-muted-foreground font-normal mt-0.5">Recommended</p>
              </button>

              <button
                type="button"
                onClick={() => setPostScope("SPECIFIC_POST")}
                className={`p-3 rounded-xl border text-xs font-semibold transition-all text-center ${
                  postScope === "SPECIFIC_POST"
                    ? "border-neutral-900 dark:border-white bg-neutral-50 dark:bg-neutral-800 ring-1 ring-neutral-900 dark:ring-white"
                    : "border-border hover:bg-muted/40"
                }`}
              >
                <p className="font-bold">Specific Reel / Post</p>
                <p className="text-[10px] text-muted-foreground font-normal mt-0.5">Select from account</p>
              </button>

              <button
                type="button"
                onClick={() => setPostScope("NEXT_POST")}
                className={`p-3 rounded-xl border text-xs font-semibold transition-all text-center ${
                  postScope === "NEXT_POST"
                    ? "border-neutral-900 dark:border-white bg-neutral-50 dark:bg-neutral-800 ring-1 ring-neutral-900 dark:ring-white"
                    : "border-border hover:bg-muted/40"
                }`}
              >
                <p className="font-bold">Next Post</p>
                <p className="text-[10px] text-muted-foreground font-normal mt-0.5">Auto-attaches</p>
              </button>
            </div>

            {/* Real Instagram Media Picker (when Specific Post selected) */}
            {postScope === "SPECIFIC_POST" && (
              <div className="space-y-3 pt-2 border-t border-border/60">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-foreground flex items-center gap-1.5">
                    <Instagram className="size-3.5 text-rose-500" />
                    {instagramHandle !== "yourbrand"
                      ? `Reels from @${instagramHandle}:`
                      : "Instagram Reels:"}
                  </span>
                  {loadingMedia && (
                    <span className="text-[11px] text-muted-foreground animate-pulse flex items-center gap-1">
                      <Loader2 className="size-3 animate-spin" /> Loading reels...
                    </span>
                  )}
                </div>

                {/* Selected Post Confirmation Card */}
                {selectedPost && (
                  <div className="p-3 rounded-xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={selectedPost.thumbnailUrl}
                      alt={selectedPost.caption || "Selected Reel"}
                      className="size-12 rounded-lg object-cover border border-neutral-300 dark:border-neutral-600 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-900 dark:text-white">
                        <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                        Target Reel Selected
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                        {selectedPost.caption || "Instagram Reel (No caption)"}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-[10px] font-mono shrink-0 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
                      ✓ Attached
                    </Badge>
                  </div>
                )}

                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5 max-h-56 overflow-y-auto p-1">
                  {mediaList.map((media) => {
                    const isSelected = selectedPost?.id === media.id;
                    return (
                      <div
                        key={media.id}
                        onClick={() => setSelectedPost(media)}
                        className={`group relative aspect-square rounded-xl overflow-hidden cursor-pointer border-2 transition-all ${
                          isSelected
                            ? "border-neutral-900 dark:border-white ring-2 ring-neutral-900 dark:ring-white scale-[1.02]"
                            : "border-transparent hover:border-neutral-400 opacity-80 hover:opacity-100"
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={media.thumbnailUrl}
                          alt={media.caption || "Reel"}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        />
                        {isSelected && (
                          <div className="absolute top-1.5 right-1.5 size-5 rounded-full bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 flex items-center justify-center shadow-md">
                            <Check className="size-3 stroke-[3]" />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent flex items-end p-1.5">
                          <span className="text-[10px] text-white line-clamp-1 font-medium">
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
          <Card className="rounded-2xl border-border/80 p-5 shadow-xs space-y-4">
            <div>
              <h3 className="font-bold text-sm text-foreground flex items-center gap-2">
                <span className="size-5 rounded-full bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 flex items-center justify-center text-[11px]">
                  2
                </span>
                When Follower Comments...
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Type the trigger word or choose from popular suggestions
              </p>
            </div>

            {/* Keyword Chips & Input */}
            <div className="p-3 rounded-xl border border-border/80 bg-background flex flex-wrap items-center gap-2">
              {keywords.map((kw) => (
                <span
                  key={kw}
                  className="px-2.5 py-1 rounded-lg bg-neutral-900 text-white dark:bg-white dark:text-neutral-950 font-mono font-bold text-xs flex items-center gap-1.5 shadow-xs"
                >
                  {kw}
                  <button
                    type="button"
                    onClick={() => handleRemoveKeyword(kw)}
                    className="hover:opacity-75"
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
                className="flex-1 min-w-[140px] text-xs font-semibold bg-transparent outline-none placeholder:text-muted-foreground"
              />
            </div>

            {/* Popular suggestions */}
            <div className="flex items-center gap-1.5 flex-wrap text-xs">
              <span className="text-[11px] text-muted-foreground">Suggestions:</span>
              {POPULAR_KEYWORD_PILLS.map((pill) => (
                <button
                  key={pill}
                  type="button"
                  onClick={() => handleAddKeyword(pill)}
                  className="px-2 py-0.5 rounded-md border border-border/60 hover:bg-muted text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors"
                >
                  + {pill}
                </button>
              ))}
            </div>
          </Card>

          {/* STEP 3: Automated Direct Message */}
          <Card className="rounded-2xl border-border/80 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-foreground flex items-center gap-2">
                  <span className="size-5 rounded-full bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 flex items-center justify-center text-[11px]">
                    3
                  </span>
                  Instantly Send Them This Direct Message
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Delivered straight into the commenter&apos;s Instagram inbox
                </p>
              </div>
              <span className="text-[11px] text-muted-foreground font-mono">
                {dmMessage.length}/1000
              </span>
            </div>

            {/* Token Quick Inserts */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDmMessage((prev) => `${prev} {username}`)}
                className="px-2.5 py-1 rounded-lg border border-border/80 bg-muted/30 hover:bg-muted text-xs font-mono font-medium text-foreground transition-colors"
              >
                + &#123;username&#125;
              </button>
              <button
                type="button"
                onClick={() => setDmMessage((prev) => `${prev} {link}`)}
                className="px-2.5 py-1 rounded-lg border border-border/80 bg-muted/30 hover:bg-muted text-xs font-mono font-medium text-foreground transition-colors"
              >
                + &#123;link&#125;
              </button>
            </div>

            <textarea
              rows={3}
              value={dmMessage}
              onChange={(e) => setDmMessage(e.target.value)}
              className="w-full p-3.5 rounded-xl border border-border/80 bg-background text-xs sm:text-sm font-medium focus:ring-1 focus:ring-neutral-900 dark:focus:ring-white outline-none resize-none leading-relaxed"
            />

            {/* Interactive Link Button Inside DM */}
            <div className="pt-2 border-t border-border/60 space-y-3">
              <Label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <ExternalLink className="size-3.5 text-primary" />
                Include Interactive Link Button in DM
              </Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <span className="text-[11px] text-muted-foreground">Button Title</span>
                  <Input
                    placeholder="Download Guide 📖"
                    value={buttonText}
                    onChange={(e) => setButtonText(e.target.value)}
                    className="h-9 text-xs rounded-xl"
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-[11px] text-muted-foreground">Button Destination URL</span>
                  <Input
                    placeholder="https://yourwebsite.com/guide"
                    value={buttonUrl}
                    onChange={(e) => setButtonUrl(e.target.value)}
                    className="h-9 text-xs rounded-xl"
                  />
                </div>
              </div>
            </div>
          </Card>

          {/* STEP 4: Optional Public Reply & Follow-Gate */}
          <Card className="rounded-2xl border-border/80 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-bold text-xs sm:text-sm text-foreground">
                  Reply Publicly to the Comment
                </h4>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Leaves a comment reply on your post so other followers see the automation in action
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPublicReplyEnabled(!publicReplyEnabled)}
                className={`w-11 h-6 rounded-full transition-colors p-0.5 ${
                  publicReplyEnabled ? "bg-neutral-900 dark:bg-white" : "bg-neutral-200 dark:bg-neutral-700"
                }`}
              >
                <div
                  className={`size-5 rounded-full bg-white dark:bg-neutral-900 transition-transform ${
                    publicReplyEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {publicReplyEnabled && (
              <Input
                value={publicReplyMessage}
                onChange={(e) => setPublicReplyMessage(e.target.value)}
                placeholder="Sent you a DM! 📩"
                className="h-9 text-xs rounded-xl bg-muted/40"
              />
            )}
          </Card>

          {/* Bottom Action Footer */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200/80 dark:border-neutral-800">
            <div className="text-xs">
              <p className="font-semibold text-foreground flex items-center gap-1.5">
                {postScope === "SPECIFIC_POST" ? (
                  selectedPost ? (
                    <>
                      <span className="size-2 rounded-full bg-emerald-500" />
                      Attached to Reel
                    </>
                  ) : (
                    <>
                      <span className="size-2 rounded-full bg-amber-500" />
                      Please select a reel above
                    </>
                  )
                ) : (
                  <>
                    <span className="size-2 rounded-full bg-emerald-500" />
                    Applies to all posts &amp; reels
                  </>
                )}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Trigger keyword: <code className="font-mono font-bold text-foreground">{keywords[0] || "None"}</code> • Direct message configured
              </p>
            </div>

            <Button
              size="sm"
              disabled={!canPublish}
              onClick={handlePublish}
              className={`rounded-xl text-xs font-semibold h-10 min-w-[195px] px-5 transition-all shadow-sm flex items-center justify-center gap-2 ${
                publishStatus === "success"
                  ? "bg-emerald-600 hover:bg-emerald-600 text-white"
                  : "bg-neutral-900 hover:bg-neutral-800 text-white dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100"
              }`}
            >
              {publishStatus === "publishing" && (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>Launching Automation...</span>
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

        {/* Right Column: Live Interactive Phone Simulator */}
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
