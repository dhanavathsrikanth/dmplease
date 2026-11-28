"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import {
  ArrowLeft,
  X,
  Instagram,
  Check,
  Loader2,
  Clock,
  Info,
  Image as ImageIcon,
  Sparkles,
  Plus,
  Globe2,
  Pencil,
  Trash2,
  Type,
  Link2,
  Database,
  ChevronDown,
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
import { DmVariantsEditor } from "@/components/campaigns/dm-variants-editor";
import type {
  CardElement,
  MessageFormat,
  StoredAsset,
} from "@/lib/message-formats";
import { LinkRotationSettings } from "@/components/campaigns/link-rotation-settings";
import {
  PublishChecklist,
  type ChecklistItem,
} from "@/components/campaigns/publish-checklist";
import { useDashboardSidebar } from "@/components/dashboard/sidebar-context";
import {
  clearCampaignDraft,
  loadCampaignDraft,
  saveCampaignDraft,
  type CampaignDraftState,
} from "@/lib/campaign-draft";
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

interface CampaignInitialData {
  id: string;
  name: string;
  triggerType?: string | null;
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
    links?: Array<{ title: string; url: string }> | null;
    publicReplyLimit?: number | null;
    collectQuestion?: string | null;
    collectAllowSkip?: boolean | null;
    collectCustomProperty?: {
      key: string;
      question: string;
      type: "options" | "yes_no" | "text";
      options: string[];
    } | null;
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
  /** Stable key for the local autosave draft. */
  draftKey?: string;
  /** Server-side updated_at, used to decide whether a local draft is newer. */
  initialUpdatedAt?: string | null;
}

function InlineError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="text-[11px] font-medium text-rose-600 dark:text-rose-400"
    >
      {message}
    </p>
  );
}

export function CampaignBuilder({
  initialHandle,
  initialCampaign,
  mode = "create",
  linkRotators = [],
  draftKey,
  initialUpdatedAt,
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
  const [triggerType, setTriggerType] = useState<"COMMENT" | "SHARE_TO_DM">(
    initialCampaign?.triggerType === "SHARE_TO_DM" ? "SHARE_TO_DM" : "COMMENT"
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
  const [anyKeyword, setAnyKeyword] = useState(
    initialCampaign ? (initialCampaign.triggerKeywords?.length ?? 0) === 0 : false
  );

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
  const [cards] = useState<CardElement[]>(
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
  const [collectQuestion, setCollectQuestion] = useState<string>(
    () => initialCampaign?.messageAssets?.collectQuestion ?? ""
  );
  const [collectAllowSkip, setCollectAllowSkip] = useState<boolean>(
    () => initialCampaign?.messageAssets?.collectAllowSkip ?? true
  );
  const [showPropertyPicker, setShowPropertyPicker] = useState(false);
  const [showCustomPropertyDialog, setShowCustomPropertyDialog] = useState(false);
  const [customProperty, setCustomProperty] = useState<{
    key: string;
    question: string;
    type: "options" | "yes_no" | "text";
    options: string[];
  } | null>(() => initialCampaign?.messageAssets?.collectCustomProperty ?? null);
  const [customDraft, setCustomDraft] = useState<{
    key: string;
    question: string;
    type: "options" | "yes_no" | "text";
    options: string[];
  }>({ key: "", question: "", type: "options", options: ["", ""] });
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
    typeof initialCampaign?.hourlyCap === "number" ? initialCampaign.hourlyCap : 200
  );
  const [delayMinMs] = useState<number>(() =>
    typeof initialCampaign?.delayMinMs === "number" ? initialCampaign.delayMinMs : 0
  );
  const [delayMaxMs] = useState<number>(() =>
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
  const [publicReplyLimit, setPublicReplyLimit] = useState<number>(
    initialCampaign?.messageAssets?.publicReplyLimit ?? 200
  );

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

  // Guided flow
  const [dmComposerFocused, setDmComposerFocused] = useState(false);
  const [previewView, setPreviewView] = useState<"dm" | "post">("dm");
  const dmSectionRef = useRef<HTMLDivElement>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [links, setLinks] = useState<Array<{ title: string; url: string }>>(() => {
    const stored = initialCampaign?.messageAssets?.links;
    if (stored && stored.length > 0) return stored;
    return [
      {
        title: initialCampaign?.buttonText ?? "Download Guide 📖",
        url: initialCampaign?.buttonUrl ?? "https://dmplease.vercel.app/guide",
      },
    ];
  });
  const [linkDraft, setLinkDraft] = useState({ title: "", url: "" });
  const [editingLinkIndex, setEditingLinkIndex] = useState<number | null>(null);

  // ── Autosave draft ──────────────────────────────────────────────────────
  const resolvedDraftKey =
    draftKey ?? (isEdit && initialCampaign ? `edit:${initialCampaign.id}` : "new");
  const draftReadyRef = useRef(false);
  const [draftStatus, setDraftStatus] = useState<"idle" | "saving" | "saved">(
    "idle"
  );
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);

  // Collapse the dashboard sidebar while the full-screen editor is open.
  const sidebar = useDashboardSidebar();
  const setSidebarCollapsed = sidebar?.setCollapsed;
  const sidebarWasCollapsedRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (!setSidebarCollapsed) return;
    sidebarWasCollapsedRef.current = sidebar?.collapsed ?? false;
    setSidebarCollapsed(true);
    return () => {
      if (sidebarWasCollapsedRef.current !== null) {
        setSidebarCollapsed(sidebarWasCollapsedRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSidebarCollapsed]);

  const buildDraftState = (): CampaignDraftState => ({
    name,
    triggerType,
    postScope,
    selectedPost: selectedPost
      ? {
          id: selectedPost.id,
          caption: selectedPost.caption,
          thumbnailUrl: selectedPost.thumbnailUrl,
        }
      : null,
    keywords,
    anyKeyword,
    dmMessage,
    dmVariants,
    messageFormat,
    messageAsset,
    shortLinksEnabled,
    linkRotatorId,
    buttonText,
    buttonUrl,
    collectField,
    collectCustomKey,
    collectQuestion,
    collectAllowSkip,
    customProperty,
    collectRetryMessage,
    collectSkipMessage,
    collectSuccessMessage,
    collectSkipKeywords,
    collectMaxAttempts,
    hourlyCap,
    publicReplyEnabled,
    publicReplyMessages,
    publicReplyLimit,
    followGateEnabled,
    openingMessage,
    followGateButtonLabel,
    followGateOnUnavailable,
    links,
  });

  const draftSnapshot = JSON.stringify(buildDraftState());
  const initialSnapshotRef = useRef<string | null>(null);
  if (initialSnapshotRef.current === null) {
    initialSnapshotRef.current = draftSnapshot;
  }

  // Restore a local draft once, before autosave starts writing.
  useEffect(() => {
    const draft = loadCampaignDraft(resolvedDraftKey);
    if (draft) {
      const serverUpdatedAt = initialUpdatedAt
        ? new Date(initialUpdatedAt).getTime()
        : 0;
      const shouldRestore = !isEdit || draft.savedAt > serverUpdatedAt;
      const draftMatchesInitial =
        JSON.stringify(draft.state) === initialSnapshotRef.current;
      if (!shouldRestore || draftMatchesInitial) {
        // A stale draft, or one identical to the starting state, is not worth
        // restoring.
        clearCampaignDraft(resolvedDraftKey);
      } else {
        const state = draft.state;
        setName(state.name);
        setTriggerType(state.triggerType);
        setPostScope(state.postScope);
        setSelectedPost(
          state.selectedPost
            ? {
                id: state.selectedPost.id,
                caption: state.selectedPost.caption,
                thumbnailUrl: state.selectedPost.thumbnailUrl,
                mediaType: "",
                permalink: "",
                timestamp: "",
              }
            : null
        );
        setKeywords(state.keywords);
        setAnyKeyword(state.anyKeyword);
        setDmMessage(state.dmMessage);
        setDmVariants(state.dmVariants);
        setMessageFormat(state.messageFormat);
        setMessageAsset(state.messageAsset);
        setShortLinksEnabled(state.shortLinksEnabled);
        setLinkRotatorId(state.linkRotatorId);
        setButtonText(state.buttonText);
        setButtonUrl(state.buttonUrl);
        setCollectField(state.collectField);
        setCollectCustomKey(state.collectCustomKey);
        setCollectQuestion(state.collectQuestion);
        setCollectAllowSkip(state.collectAllowSkip);
        setCustomProperty(state.customProperty);
        setCollectRetryMessage(state.collectRetryMessage);
        setCollectSkipMessage(state.collectSkipMessage);
        setCollectSuccessMessage(state.collectSuccessMessage);
        setCollectSkipKeywords(state.collectSkipKeywords);
        setCollectMaxAttempts(state.collectMaxAttempts);
        setHourlyCap(state.hourlyCap);
        setPublicReplyEnabled(state.publicReplyEnabled);
        setPublicReplyMessages(state.publicReplyMessages);
        setPublicReplyLimit(state.publicReplyLimit);
        setFollowGateEnabled(state.followGateEnabled);
        setOpeningMessage(state.openingMessage);
        setFollowGateButtonLabel(state.followGateButtonLabel);
        setFollowGateOnUnavailable(state.followGateOnUnavailable);
        setLinks(state.links);
        setDraftRestored(true);
        setDraftSavedAt(draft.savedAt);
        setDraftStatus("saved");
      }
    }
    draftReadyRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedDraftKey]);

  useEffect(() => {
    if (!draftReadyRef.current) return;
    if (draftSnapshot === initialSnapshotRef.current) return;
    setDraftStatus("saving");
    const timer = setTimeout(() => {
      const savedAt = saveCampaignDraft(
        resolvedDraftKey,
        JSON.parse(draftSnapshot) as CampaignDraftState
      );
      if (savedAt) {
        setDraftSavedAt(savedAt);
        setDraftStatus("saved");
      } else {
        setDraftStatus("idle");
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [resolvedDraftKey, draftSnapshot]);

  const uploadMedia = async (file: File) => {
    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf";
    if (!isImage && !isPdf) {
      setMediaError("Only images and PDF documents are supported.");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setMediaError("File is too large. Maximum size is 25 MB.");
      return;
    }
    const format = isPdf ? "pdf" : "media";
    setUploadingMedia(true);
    setMediaError(null);
    try {
      const signRes = await fetch("/api/assets/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format,
          mimeType: file.type,
          sizeBytes: file.size,
          filename: file.name,
        }),
      });
      const ticket = (await signRes.json()) as {
        uploadUrl?: string;
        objectKey?: string;
        publicUrl?: string;
        error?: string;
      };
      if (!signRes.ok || !ticket.uploadUrl || !ticket.publicUrl || !ticket.objectKey) {
        throw new Error(ticket.error ?? "Could not prepare upload");
      }
      const put = await fetch(ticket.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) throw new Error("Upload failed. Check the R2 CORS policy.");
      setMessageAsset({
        url: ticket.publicUrl,
        key: ticket.objectKey,
        mimeType: file.type,
        sizeBytes: file.size,
        filename: file.name,
      });
      setMessageFormat(format);
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingMedia(false);
    }
  };

  // Validation
  const isMissingPost = postScope === "SPECIFIC_POST" && !selectedPost;
  const validationErrors: Record<string, string> = {};
  if (!name.trim()) {
    validationErrors.name = "Give the campaign a name.";
  }
  if (isMissingPost) {
    validationErrors.post =
      "Choose the post or reel this automation should watch.";
  }
  if (triggerType === "COMMENT" && !anyKeyword && keywords.length === 0) {
    validationErrors.keywords = "Add a keyword or turn on Any comment.";
  }
  if (!dmMessage.trim()) {
    validationErrors.dmMessage = "Write the message people will receive.";
  } else if (dmMessage.length > 1000) {
    validationErrors.dmMessage = "Keep the DM under 1000 characters.";
  }
  if (collectField === "custom" && !collectCustomKey.trim()) {
    validationErrors.collect = "Choose a contact property to collect.";
  }
  if (followGateEnabled && !openingMessage.trim()) {
    validationErrors.openingMessage = "Add the opening message.";
  }
  if (
    publicReplyEnabled &&
    publicReplyMessages.every((message) => !message.trim())
  ) {
    validationErrors.publicReply = "Add at least one public reply.";
  }
  if (
    links.some(
      (link) => link.url.trim() && !/^https?:\/\//i.test(link.url.trim())
    )
  ) {
    validationErrors.links = "Links must start with http:// or https://.";
  }

  const canPublish =
    Object.keys(validationErrors).length === 0 && publishStatus === "idle";

  const checklistItems: ChecklistItem[] = [
    {
      id: "name",
      label: "Campaign name",
      description: name.trim() || "Add a name",
      status: validationErrors.name ? "incomplete" : "complete",
      targetId: "campaign-name",
    },
    {
      id: "post",
      label: "Post or reel",
      description:
        postScope === "SPECIFIC_POST"
          ? selectedPost
            ? selectedPost.caption?.trim() || "Selected reel"
            : "Choose a reel"
          : postScope === "NEXT_POST"
            ? "Next post"
            : "Any post or reel",
      status: validationErrors.post ? "incomplete" : "complete",
      targetId: "step-1",
    },
    {
      id: "keywords",
      label: "Trigger keyword",
      description:
        triggerType === "SHARE_TO_DM"
          ? "Share to DM"
          : anyKeyword
            ? "Any comment"
            : keywords.length > 0
              ? keywords.join(", ")
              : "Add a keyword",
      status:
        triggerType === "SHARE_TO_DM" || !validationErrors.keywords
          ? "complete"
          : "incomplete",
      targetId: triggerType === "SHARE_TO_DM" ? "step-1" : "step-2",
    },
    {
      id: "dm",
      label: "DM message",
      description: dmMessage.trim()
        ? `${dmMessage.trim().length} characters`
        : "Write the message",
      status: validationErrors.dmMessage ? "incomplete" : "complete",
      targetId: "step-3",
    },
    {
      id: "links",
      label: "Links",
      description: links.some((link) => link.url.trim())
        ? `${links.filter((link) => link.url.trim()).length} added`
        : "Optional",
      status: validationErrors.links
        ? "incomplete"
        : links.some((link) => link.url.trim())
          ? "complete"
          : "optional",
      targetId: "step-links",
    },
    {
      id: "collect",
      label: "Collect info",
      description:
        collectField === "none"
          ? "Optional"
          : collectField === "custom"
            ? collectCustomKey || "Choose property"
            : collectField,
      status:
        collectField === "none"
          ? "optional"
          : validationErrors.collect
            ? "incomplete"
            : "complete",
      targetId: "step-collect",
    },
    {
      id: "public-reply",
      label: "Public reply",
      description: publicReplyEnabled
        ? `${publicReplyMessages.filter((message) => message.trim()).length} message(s)`
        : "Optional",
      status: !publicReplyEnabled
        ? "optional"
        : validationErrors.publicReply
          ? "incomplete"
          : "complete",
      targetId: "step-public-reply",
    },
    {
      id: "follow-gate",
      label: "Ask for follow",
      description: followGateEnabled ? "On" : "Optional",
      status: !followGateEnabled
        ? "optional"
        : validationErrors.openingMessage
          ? "incomplete"
          : "complete",
      targetId: "step-follow-gate",
    },
  ];

  // Keep the editor fixed to the viewport; only the settings panel scrolls.
  useEffect(() => {
    const previousBody = document.body.style.overflow;
    const previousHtml = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBody;
      document.documentElement.style.overflow = previousHtml;
    };
  }, []);

  // When the Send a DM section scrolls into view, show the DM preview.
  useEffect(() => {
    const node = dmSectionRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setPreviewView("dm");
        }
      },
      { threshold: 0.35 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

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
      goal: triggerType === "SHARE_TO_DM" ? "share_to_dm" : "comment_to_dm",
      triggerType,
      postScope,
      postId: selectedPost?.id,
      postThumbnailUrl: selectedPost?.thumbnailUrl,
      postCaption: selectedPost?.caption,
      triggerKeywords: anyKeyword ? [] : keywords,
      dmMessage,
      dmVariants,
      messageFormat,
      messageAssets: {
        format: messageFormat,
        text: dmMessage,
        asset: messageAsset,
        cards,
        links: links.filter((link) => link.url.trim()),
        publicReplyLimit,
        collectQuestion: collectQuestion.trim() || undefined,
        collectAllowSkip,
        collectCustomProperty: customProperty ?? undefined,
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
        clearCampaignDraft(resolvedDraftKey);
        setDraftStatus("idle");
        setDraftSavedAt(null);
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
    <div className="fixed inset-x-0 bottom-0 top-14 z-10 flex flex-col overflow-hidden bg-[#F1F1F1] p-4 pb-0 antialiased selection:bg-[#ffd02f] selection:text-[#1c1c1e] sm:p-6 sm:pb-0 lg:p-8 lg:pb-0 md:left-[var(--sidebar-width)] dark:bg-background">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10 opacity-60"
        style={{
          backgroundImage:
            "radial-gradient(rgba(224,230,230,0.9) 1.4px, transparent 1.4px)",
          backgroundSize: "14px 14px",
        }}
      />
      {/* ── Editor header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="size-8 rounded-full text-muted-foreground hover:text-foreground">
            <Link href="/dashboard/campaigns">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Editor
            </p>
            <Input
              id="campaign-name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              className="h-8 w-64 rounded-lg border-transparent bg-transparent px-2 text-base font-semibold tracking-tight hover:border-border focus:border-ring sm:w-80"
            />
            {validationErrors.name && (
              <InlineError message={validationErrors.name} />
            )}
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <span
            className="hidden items-center gap-1.5 text-[11px] text-muted-foreground sm:flex"
            title={
              draftSavedAt
                ? `Last saved ${new Date(draftSavedAt).toLocaleTimeString()}`
                : "Changes are saved locally as you edit"
            }
          >
            {draftStatus === "saving" ? (
              <Loader2 className="size-3 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="size-3 text-[#00b473]" aria-hidden="true" />
            )}
            {draftStatus === "saving"
              ? "Saving draft…"
              : draftSavedAt
                ? "Draft saved"
                : "Draft autosaves"}
          </span>
          <Button
            variant="outline"
            size="sm"
            asChild
            className="h-9 rounded-full border-border px-4 text-xs font-medium"
          >
            <Link
              href="/dashboard/campaigns"
              onClick={() => clearCampaignDraft(resolvedDraftKey)}
            >
              {isEdit ? "Cancel" : "Discard"}
            </Link>
          </Button>
          <Button
            size="sm"
            disabled={!canPublish}
            onClick={handlePublish}
            className={`flex h-9 min-w-[150px] items-center justify-center gap-2 rounded-full px-5 text-xs font-semibold shadow-xs transition-[border-color,background-color,color,box-shadow,transform] ${
              publishStatus === "success"
                ? "bg-[#00b473] text-white"
                : "bg-[#1c1c1e] text-white hover:bg-[#2c2c34] dark:bg-[#ffd02f] dark:text-[#1c1c1e] dark:hover:bg-[#fcb900]"
            }`}
          >
            {publishStatus === "publishing" && (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                <span>{isEdit ? "Saving..." : "Going live..."}</span>
              </>
            )}
            {publishStatus === "success" && (
              <>
                <Check className="size-4 stroke-[3]" />
                <span>{isEdit ? "Saved!" : "Live!"}</span>
              </>
            )}
            {publishStatus === "idle" && (
              <span>
                {isMissingPost && !isEdit
                  ? "Pick a Reel"
                  : isEdit
                    ? "Save Changes"
                    : "Go Live"}
              </span>
            )}
          </Button>
        </div>
      </div>

      {draftRestored && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#6a06e4]/25 bg-[#6a06e4]/5 px-3 py-2 text-[11px] text-foreground">
          <span className="flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-[#6a06e4]" aria-hidden="true" />
            We restored your unsaved draft
            {draftSavedAt
              ? ` from ${new Date(draftSavedAt).toLocaleString()}`
              : ""}
            .
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                clearCampaignDraft(resolvedDraftKey);
                window.location.reload();
              }}
              className="font-semibold text-[#6a06e4] hover:underline"
            >
              Start fresh
            </button>
            <button
              type="button"
              onClick={() => setDraftRestored(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {errorMsg && (
        <div role="alert" aria-live="assertive" className="mt-4 flex flex-col gap-1.5 rounded-2xl border border-destructive/40 bg-destructive/10 p-3.5 text-xs font-medium text-destructive">
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

      {/* ── Editor split: checklist left, preview center, editor right ── */}
      <div className="mx-auto mt-4 grid min-h-0 w-full max-w-[1600px] flex-1 grid-cols-1 items-stretch gap-5 lg:grid-cols-[minmax(0,1fr)_490px] xl:grid-cols-[280px_minmax(380px,440px)_minmax(0,1fr)]">
        {/* Publish checklist */}
        <div className="order-1 hidden min-h-0 lg:order-none lg:col-span-2 lg:block xl:col-span-1 xl:col-start-1 xl:row-start-1 xl:overflow-y-auto">
          <PublishChecklist
            items={checklistItems}
            canPublish={canPublish}
            isEdit={isEdit}
            publishStatus={publishStatus}
            onPublish={handlePublish}
            onFix={(targetId) => {
              const element = document.getElementById(targetId);
              if (!element) return;
              element.scrollIntoView({
                behavior: "smooth",
                block: "center",
              });
              if (
                element instanceof HTMLInputElement ||
                element instanceof HTMLTextAreaElement
              ) {
                element.focus({ preventScroll: true });
              }
            }}
          />
        </div>

        {/* Editor panel */}
        <div className="order-2 h-full min-h-0 overflow-y-auto rounded-3xl border border-border bg-[#FAFAFA] p-4 shadow-card lg:order-2 xl:col-start-3 xl:row-start-1 dark:bg-card">
          <div className="mx-auto mt-4 w-full max-w-[720px] space-y-4">
          {/* STEP 1: Select a Post or Reel */}
          <Card
            id="step-1"
            className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 p-5 shadow-subtle space-y-3"
          >
            <div>
              <h3 className="font-semibold text-sm text-foreground flex items-center gap-2">
                <span className="size-5 rounded-full bg-[#1c1c1e] text-white dark:bg-white dark:text-[#1c1c1e] flex items-center justify-center text-[10px] font-bold">
                  1
                </span>
                Select a Post or Reel
              </h3>
              <p className="text-xs text-[#555a6a] dark:text-muted-foreground mt-0.5">
                Pick the trigger and where it applies. You can change it later.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Campaign trigger">
              <button
                type="button"
                role="radio"
                aria-checked={triggerType === "COMMENT"}
                onClick={() => setTriggerType("COMMENT")}
                className={`p-3 rounded-2xl border text-left transition-[border-color,background-color,color,box-shadow,transform] ${
                  triggerType === "COMMENT"
                    ? "border-[#4262ff] bg-[#f5f3ff] dark:bg-[#4262ff]/10"
                    : "border-[#e0e2e8] dark:border-border hover:bg-[#f7f8fa]"
                }`}
              >
                <p className="font-semibold text-xs text-foreground">Comment keyword</p>
                <p className="text-[10px] text-[#555a6a] dark:text-muted-foreground mt-0.5">
                  Someone comments a word on your post or reel.
                </p>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={triggerType === "SHARE_TO_DM"}
                onClick={() => setTriggerType("SHARE_TO_DM")}
                className={`p-3 rounded-2xl border text-left transition-[border-color,background-color,color,box-shadow,transform] ${
                  triggerType === "SHARE_TO_DM"
                    ? "border-[#4262ff] bg-[#f5f3ff] dark:bg-[#4262ff]/10"
                    : "border-[#e0e2e8] dark:border-border hover:bg-[#f7f8fa]"
                }`}
              >
                <p className="font-semibold text-xs text-foreground">Share to DM</p>
                <p className="text-[10px] text-[#555a6a] dark:text-muted-foreground mt-0.5">
                  Someone shares your reel or post into your DM.
                </p>
              </button>
            </div>
            {triggerType === "SHARE_TO_DM" && (
              <p className="rounded-xl bg-[#fff8e0]/70 dark:bg-[#746019]/20 px-3 py-2 text-[11px] text-[#746019] dark:text-[#ffd02f]">
                No keyword needed. We send your thank-you DM once per share, and
                skip anyone already contacted in the last 30 days.
              </p>
            )}
          </Card>

          {/* STEP 1b: Target Content Scope */}
          <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 p-5 shadow-subtle space-y-3.5">
            <div>
              <h3 className="font-semibold text-sm text-foreground">
                Where should it apply?
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
                className={`p-3 rounded-2xl border text-xs font-medium transition-[border-color,background-color,color,box-shadow,transform] text-center ${
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
                className={`p-3 rounded-2xl border text-xs font-medium transition-[border-color,background-color,color,box-shadow,transform] text-center ${
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
                className={`p-3 rounded-2xl border text-xs font-medium transition-[border-color,background-color,color,box-shadow,transform] text-center ${
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
                        className={`group relative aspect-square rounded-xl overflow-hidden cursor-pointer border-2 transition-[border-color,background-color,color,box-shadow,transform] ${
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
            {(validationErrors.post ||
              fieldErrors.postId?.[0] ||
              fieldErrors.postScope?.[0]) && (
              <InlineError
                message={
                  validationErrors.post ??
                  fieldErrors.postId?.[0] ??
                  fieldErrors.postScope?.[0]
                }
              />
            )}
          </Card>

          {/* STEP 2: Setup Keywords (comment campaigns only) */}
          {triggerType === "COMMENT" && (
          <Card
            id="step-2"
            className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 p-5 shadow-subtle space-y-3.5"
          >
            <div>
              <h3 className="font-semibold text-sm text-foreground flex items-center gap-2">
                <span className="size-5 rounded-full bg-[#1c1c1c] text-white dark:bg-white dark:text-[#1c1c1e] flex items-center justify-center text-[10px] font-bold">
                  2
                </span>
                Setup Keywords
              </h3>
              <p className="text-xs text-[#555a6a] dark:text-muted-foreground mt-0.5">
                Followers comment this word to trigger the DM.
              </p>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-[#e0e2e8] bg-muted/30 px-3 py-2.5 dark:border-border">
              <div>
                <p className="text-xs font-semibold text-foreground">
                  Any comment
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Trigger on every comment, including emojis and any text.
                </p>
              </div>
              <Switch
                checked={anyKeyword}
                onCheckedChange={(checked) => {
                  setAnyKeyword(checked);
                  if (checked) {
                    setKeywords([]);
                    setKeywordInput("");
                  }
                }}
                aria-label="Trigger on any comment"
              />
            </div>

            {!anyKeyword && (
              <>
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
              </>
            )}
            {(validationErrors.keywords || fieldErrors.triggerKeywords?.[0]) && (
              <InlineError
                message={
                  validationErrors.keywords ?? fieldErrors.triggerKeywords?.[0]
                }
              />
            )}
          </Card>
          )}

          {/* Trigger on share */}
          <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 p-4 shadow-subtle">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-foreground">
                  Content shared in DM
                </span>
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label="About trigger on share"
                        className="text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        <Info className="size-3.5" aria-hidden="true" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="left"
                      className="max-w-xs rounded-2xl p-3 text-left text-[11px] font-normal leading-relaxed"
                    >
                      <p className="font-semibold text-foreground">
                        Trigger on Share
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        When enabled, this automation will automatically send a
                        DM when someone shares this reel via Instagram DM.
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        This allows you to engage with users who share your
                        content, even if they haven&apos;t liked or commented on
                        the reel itself.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Switch
                checked={triggerType === "SHARE_TO_DM"}
                onCheckedChange={(checked) =>
                  setTriggerType(checked ? "SHARE_TO_DM" : "COMMENT")
                }
                aria-label="Trigger on share"
              />
            </div>
          </Card>

          {/* STEP 3: Send a DM */}
          <Card
            id="step-3"
            ref={dmSectionRef}
            className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 p-5 shadow-subtle space-y-3.5"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-sm text-foreground flex items-center gap-2">
                  <span className="size-5 rounded-full bg-[#1c1c1c] text-white dark:bg-white dark:text-[#1c1c1e] flex items-center justify-center text-[10px] font-bold">
                    3
                  </span>
                  Send a DM
                </h3>
                <p className="text-xs text-[#555a6a] dark:text-muted-foreground mt-0.5">
                  Delivered instantly to the commenter&apos;s Instagram inbox via Meta Send API.
                </p>
              </div>
              <button
                type="button"
                className="rounded-[11px] border border-[#acacbe] bg-[#071329] px-2.5 py-1 text-[11px] font-bold text-neutral-200"
              >
                Variations
              </button>
            </div>

            {/* Image dropzone */}
            <input
              ref={mediaInputRef}
              type="file"
              accept="image/*,application/pdf"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadMedia(file);
                event.target.value = "";
              }}
            />
            {messageAsset && !["card", "carousel"].includes(messageFormat) ? (
              <div className="overflow-hidden rounded-[14px] border border-[#d4d9d9] bg-background">
                {messageAsset.mimeType?.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={messageAsset.url}
                    alt={messageAsset.filename || "Selected media"}
                    className="h-40 w-full object-cover"
                  />
                ) : messageAsset.mimeType?.startsWith("video/") ? (
                  <video
                    src={messageAsset.url}
                    controls
                    className="h-40 w-full object-cover"
                  />
                ) : (
                  <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
                    <ImageIcon className="size-4" />
                    <span className="truncate">
                      {messageAsset.filename || "Attached file"}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="truncate text-[11px] text-muted-foreground">
                    {messageAsset.filename || "Attached file"}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => mediaInputRef.current?.click()}
                      className="text-[11px] font-semibold text-[#6a06e4] hover:underline"
                    >
                      Change
                    </button>
                    <button
                      type="button"
                      onClick={() => setMessageAsset(null)}
                      className="text-[11px] font-semibold text-destructive hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => mediaInputRef.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const file = event.dataTransfer.files?.[0];
                  if (file) void uploadMedia(file);
                }}
                disabled={uploadingMedia}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-[14px] border-2 border-dashed border-[#d4d9d9] text-sm font-medium text-[#8c919f] transition-colors hover:bg-muted/40 disabled:opacity-60"
              >
                <ImageIcon className="size-4" aria-hidden="true" />
                {uploadingMedia ? "Uploading…" : "Select / Drop an Image or PDF"}
              </button>
            )}
            {mediaError && (
              <p className="text-[11px] text-destructive">{mediaError}</p>
            )}

            {/* Personalise message */}
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <Sparkles
                  className="size-3.5 text-brand-soft-foreground dark:text-brand"
                  aria-hidden="true"
                />
                <span className="text-xs font-semibold text-foreground">
                  Personalise message
                </span>
                <span className="rounded-full bg-brand-soft px-2 py-0.5 font-mono text-[10px] text-brand-soft-foreground">
                  {"{username}"}
                </span>
              </div>
              <Switch
                checked={dmMessage.includes("{username}")}
                onCheckedChange={(checked) => {
                  if (checked) {
                    if (!dmMessage.includes("{username}")) {
                      setDmMessage(`Hey {username}! ${dmMessage}`.trim());
                    }
                  } else {
                    setDmMessage(
                      dmMessage.replace(/\{username\}\s*/g, "").trim()
                    );
                  }
                }}
                aria-label="Personalise message with username"
              />
            </div>

            {/* Message textarea */}
            <div className="rounded-[14px] border border-[#d4d9d9] bg-background">
              <label htmlFor="campaign-dm-message" className="sr-only">
                Direct message text
              </label>
              <textarea
                id="campaign-dm-message"
                rows={3}
                value={dmMessage}
                maxLength={1000}
                onChange={(e) => setDmMessage(e.target.value)}
                onFocus={() => setDmComposerFocused(true)}
                onBlur={() => setDmComposerFocused(false)}
                placeholder="Enter your message here..."
                aria-describedby="campaign-dm-help"
                className="w-full resize-none rounded-t-[14px] bg-transparent px-3 py-3 text-sm leading-relaxed outline-none placeholder:text-[#99a1af]"
              />
              <div className="flex items-center justify-between px-3 pb-2">
                <span className="text-[11px] text-[#8c919f]">
                  {dmMessage.length} / 1000
                </span>
                <span className="text-sm" aria-hidden="true">
                  😀
                </span>
              </div>
            </div>
            <p id="campaign-dm-help" className="sr-only">
              Use the personalise toggle or the variable buttons to insert
              personalisation tokens.
            </p>
            {(validationErrors.dmMessage || fieldErrors.dmMessage?.[0]) && (
              <InlineError
                message={
                  validationErrors.dmMessage ?? fieldErrors.dmMessage?.[0]
                }
              />
            )}

            {/* Add Link */}
            <div id="step-links" className="space-y-2">
            <button
              type="button"
              onClick={() => {
                setLinkDraft({ title: "", url: "" });
                setEditingLinkIndex(null);
                setShowLinkDialog(true);
              }}
              className="flex w-full items-center gap-2 rounded-[14px] border border-[#d4d9d9] bg-background px-3 py-2.5 text-sm font-semibold text-[#6a06e4]"
            >
              <span className="flex size-5 items-center justify-center rounded-md border border-[#6a06e4]/30 text-[#6a06e4]">
                <Plus className="size-3" aria-hidden="true" />
              </span>
              Add Link
            </button>

            {links.some((link) => link.url.trim()) && (
              <div className="space-y-2">
                {links.map((link, index) =>
                  link.url.trim() ? (
                    <div
                      key={index}
                      className="flex items-center gap-2 rounded-[14px] border border-[#d4d9d9] bg-background px-3 py-2"
                    >
                      <Globe2 className="size-4 shrink-0 text-[#6a06e4]" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-foreground">
                          {link.url}
                        </p>
                        {link.title && (
                          <p className="truncate text-[10px] text-muted-foreground">
                            {link.title}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setLinkDraft({ title: link.title, url: link.url });
                          setEditingLinkIndex(index);
                          setShowLinkDialog(true);
                        }}
                        aria-label="Edit link"
                        className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const next = links.filter((_, i) => i !== index);
                          setLinks(next);
                          const first = next.find((item) => item.url.trim());
                          setButtonText(first?.title.trim() || "Open link");
                          setButtonUrl(first?.url.trim() || "");
                        }}
                        aria-label="Remove link"
                        className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ) : null
                )}
              </div>
            )}
            {(validationErrors.links || fieldErrors.buttonUrl?.[0]) && (
              <InlineError
                message={validationErrors.links ?? fieldErrors.buttonUrl?.[0]}
              />
            )}
            </div>

          </Card>

          <div className="space-y-4">
          <LinkRotationSettings
            enabled={shortLinksEnabled}
            onEnabledChange={setShortLinksEnabled}
            rotators={linkRotators}
            rotatorId={linkRotatorId}
            onRotatorIdChange={setLinkRotatorId}
            disabled={publishStatus === "publishing"}
          />

          <DmVariantsEditor
            primaryMessage={dmMessage}
            variants={dmVariants}
            onVariantsChange={setDmVariants}
            disabled={publishStatus === "publishing"}
          />

          {/* STEP 3: Collect info (lead capture) */}
          <Card
            id="step-collect"
            className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 p-5 shadow-subtle space-y-4"
          >
            <div className="flex items-center justify-between gap-4">
              <h3 className="font-semibold text-sm text-foreground">Collect Info</h3>
              <Switch
                checked={collectField !== "none"}
                onCheckedChange={(checked) => {
                  if (checked) {
                    if (collectField === "none") setCollectField("email");
                  } else {
                    setCollectField("none");
                  }
                }}
                disabled={publishStatus === "publishing"}
                aria-label="Collect info"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Ask contacts for email, phone, or other details in DMs
            </p>

            {collectField !== "none" && (
              <>
                <div className="flex items-center gap-2 rounded-xl border border-[#e0e2e8] bg-background px-3 py-2.5 dark:border-border">
                  <input
                    value={collectQuestion}
                    onChange={(event) => setCollectQuestion(event.target.value)}
                    placeholder="Enter your question"
                    disabled={publishStatus === "publishing"}
                    className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  />
                  <span className="text-sm" aria-hidden="true">
                    😀
                  </span>
                </div>

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowPropertyPicker((value) => !value)}
                    disabled={publishStatus === "publishing"}
                    className="flex w-full items-center gap-2 rounded-xl border border-[#e0e2e8] bg-background px-3 py-2.5 text-sm font-semibold text-[#6a06e4] dark:border-border"
                  >
                    <Database className="size-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-left">
                      {collectField === "custom"
                        ? collectCustomKey === "gender"
                          ? "Gender"
                          : collectCustomKey === "age_group"
                            ? "Age Group"
                            : collectCustomKey.trim() || "Select Contact Property"
                        : collectField === "email"
                          ? "Email"
                          : collectField === "phone"
                            ? "Phone"
                            : collectField === "name"
                              ? "Name"
                              : "Select Contact Property"}
                    </span>
                    <ChevronDown
                      className={`size-4 shrink-0 transition-transform ${
                        showPropertyPicker ? "rotate-180" : ""
                      }`}
                      aria-hidden="true"
                    />
                  </button>

                  {showPropertyPicker && (
                    <div className="mt-2 rounded-xl border border-[#e0e2e8] bg-background p-3 shadow-lg dark:border-border">
                      <p className="text-[11px] font-semibold text-foreground">
                        Contact Properties
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {[
                          { label: "Email", value: "email" },
                          { label: "Phone", value: "phone" },
                          { label: "Gender", value: "gender" },
                          { label: "Age Group", value: "age_group" },
                        ].map((property) => {
                          const selected =
                            (property.value === "email" && collectField === "email") ||
                            (property.value === "phone" && collectField === "phone") ||
                            (collectField === "custom" &&
                              collectCustomKey === property.value);
                          return (
                            <button
                              key={property.value}
                              type="button"
                              onClick={() => {
                                if (
                                  property.value === "email" ||
                                  property.value === "phone"
                                ) {
                                  setCollectField(property.value);
                                  setCollectCustomKey("");
                                } else {
                                  setCollectField("custom");
                                  setCollectCustomKey(property.value);
                                }
                                setShowPropertyPicker(false);
                              }}
                              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                                selected
                                  ? "border-[#6a06e4] bg-[#6a06e4]/10 text-[#6a06e4]"
                                  : "border-[#e0e2e8] text-foreground hover:bg-muted/40 dark:border-border"
                              }`}
                            >
                              {property.label}
                            </button>
                          );
                        })}
                      </div>
                      <p className="mt-3 text-[11px] font-semibold text-foreground">
                        Custom Properties
                      </p>
                      <div className="mt-2 rounded-lg border border-dashed border-[#e0e2e8] px-3 py-2 text-center text-[11px] text-muted-foreground dark:border-border">
                        No custom properties yet
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setCustomDraft(
                            customProperty ?? {
                              key: "",
                              question: "",
                              type: "options",
                              options: ["", ""],
                            }
                          );
                          setShowCustomPropertyDialog(true);
                          setShowPropertyPicker(false);
                        }}
                        className="mt-2 w-full rounded-lg border border-dashed border-[#6a06e4] px-3 py-2 text-xs font-semibold text-[#6a06e4]"
                      >
                        + Create custom property
                      </button>
                    </div>
                  )}
                </div>

                {(validationErrors.collect || fieldErrors.collectField?.[0]) && (
                  <InlineError
                    message={
                      validationErrors.collect ?? fieldErrors.collectField?.[0]
                    }
                  />
                )}

                {collectField === "custom" &&
                  collectCustomKey !== "gender" &&
                  collectCustomKey !== "age_group" && (
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
                  </div>
                )}

                <div className="flex items-center justify-between gap-3 rounded-xl border border-[#e0e2e8] bg-background px-3 py-2.5 dark:border-border">
                  <span className="text-sm font-semibold text-foreground">
                    Allow skipping
                  </span>
                  <Switch
                    checked={collectAllowSkip}
                    onCheckedChange={setCollectAllowSkip}
                    disabled={publishStatus === "publishing"}
                    aria-label="Allow skipping"
                  />
                </div>

                {(collectField === "email" || collectField === "phone") && (
                  <div className="space-y-2 border-t border-[#e0e2e8] pt-3 dark:border-border">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        Retry Message
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Setup a message if response is of incorrect format
                      </p>
                    </div>
                    <div className="flex items-center gap-2 rounded-xl border border-[#e0e2e8] bg-background px-3 py-2.5 dark:border-border">
                      <input
                        value={collectRetryMessage}
                        onChange={(event) =>
                          setCollectRetryMessage(event.target.value)
                        }
                        placeholder={
                          collectField === "email"
                            ? "Please enter a valid email address."
                            : "Please enter a valid phone number."
                        }
                        disabled={publishStatus === "publishing"}
                        className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                      />
                      <span className="text-sm" aria-hidden="true">
                        😀
                      </span>
                    </div>
                  </div>
                )}

                <div className="rounded-xl border border-[#e0e2e8] bg-[#f7f8fa] p-3.5 dark:border-border dark:bg-muted/30">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6b6f7e]">
                    How it works
                  </p>
                  <ol className="mt-2 space-y-2 text-[11px] text-[#555a6a] dark:text-muted-foreground">
                    <li className="flex gap-2">
                      <span className="font-mono text-[10px] text-[#4262ff]">1</span>
                      Follower comments your keyword.
                    </li>
                    <li className="flex gap-2">
                      <span className="font-mono text-[10px] text-[#4262ff]">2</span>
                      We ask your question.
                    </li>
                    <li className="flex gap-2">
                      <span className="font-mono text-[10px] text-[#4262ff]">3</span>
                      They reply. We validate it.
                    </li>
                    <li className="flex gap-2">
                      <span className="font-mono text-[10px] text-[#4262ff]">4</span>
                      Valid reply → we deliver your promise and save the contact.
                    </li>
                  </ol>
                </div>

                <details className="rounded-xl border border-[#e0e2e8] p-3.5 dark:border-border">
                  <summary className="cursor-pointer text-[11px] font-semibold text-foreground">
                    Customize the messages (optional)
                  </summary>
                  <div className="mt-3 space-y-3">
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
                        className="w-full resize-none rounded-xl border border-[#c7cad5] bg-background px-3.5 py-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:border-border"
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
                        className="w-full resize-none rounded-xl border border-[#c7cad5] bg-background px-3.5 py-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:border-border"
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
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
                          onChange={(event) =>
                            setCollectMaxAttempts(Number(event.target.value))
                          }
                          disabled={publishStatus === "publishing"}
                          className="h-9 text-xs"
                        />
                        <p className="text-[10px] text-muted-foreground">
                          After this many invalid replies we send the skip message.
                        </p>
                      </div>
                    </div>
                  </div>
                </details>
              </>
            )}
          </Card>

          {/* STEP 4: Optional Public Comment Reply */}
          <div id="step-public-reply">
            <PublicReplySettings
              enabled={publicReplyEnabled}
              onEnabledChange={setPublicReplyEnabled}
              messages={publicReplyMessages}
              onMessagesChange={setPublicReplyMessages}
              limit={publicReplyLimit}
              onLimitChange={setPublicReplyLimit}
              errors={[
                ...(fieldErrors.publicReplyMessages ?? []),
                ...(validationErrors.publicReply
                  ? [validationErrors.publicReply]
                  : []),
              ]}
              disabled={publishStatus === "publishing"}
            />
          </div>

          {/* STEP 5: Ask for Follow */}
          <div id="step-follow-gate">
            <FollowGateSettings
              mode={triggerType === "SHARE_TO_DM" ? "direct" : "comment"}
              enabled={followGateEnabled}
              onEnabledChange={setFollowGateEnabled}
              openingMessage={openingMessage}
              onOpeningMessageChange={setOpeningMessage}
              buttonLabel={followGateButtonLabel}
              onButtonLabelChange={setFollowGateButtonLabel}
              onUnavailable={followGateOnUnavailable}
              onUnavailableChange={setFollowGateOnUnavailable}
              fieldErrors={{
                ...fieldErrors,
                openingMessage: [
                  ...(fieldErrors.openingMessage ?? []),
                  ...(validationErrors.openingMessage
                    ? [validationErrors.openingMessage]
                    : []),
                ],
              }}
              disabled={publishStatus === "publishing"}
            />
          </div>

          {/* Hourly cap */}
          <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 p-5 shadow-subtle space-y-3">
            <div>
              <h3 className="font-semibold text-sm text-foreground">Hourly cap</h3>
              <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground mt-0.5">
                Choose how many DMs we send per hour. The rest are queued automatically.
              </p>
            </div>
            <div className="grid grid-cols-4 gap-1 rounded-xl bg-[#f1f1f1] p-1 dark:bg-muted/40">
              {[50, 200, 400, 800].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setHourlyCap(value)}
                  disabled={publishStatus === "publishing"}
                  className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
                    hourlyCap === value
                      ? "bg-white text-[#1d2842] shadow-sm dark:bg-background dark:text-foreground"
                      : "text-[#8c919f] hover:text-[#1d2842] dark:text-muted-foreground dark:hover:text-foreground"
                  }`}
                >
                  {value}
                </button>
              ))}
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
          </div>
        </div>

        {/* Preview */}
        <div className="order-3 flex h-full min-h-0 items-center justify-center overflow-hidden rounded-3xl border border-border bg-[#E9EDED] p-4 shadow-[inset_0px_13.43px_17.10px_rgba(0,0,0,0.1)] lg:order-1 xl:col-start-2 xl:row-start-1 dark:bg-muted/30">
          <div className="w-full max-w-[340px]">
            <p className="mb-2 text-sm font-semibold text-foreground">Preview Automation</p>
            <div className="phone-preview-scale">
            <PhonePreview
            triggerType={triggerType}
            postScope={postScope}
            postThumbnailUrl={selectedPost?.thumbnailUrl}
            postCaption={selectedPost?.caption}
            view={previewView}
            onViewChange={setPreviewView}
            triggerKeyword={anyKeyword ? "Any comment" : keywords[0] || "GUIDE"}
            dmMessage={dmMessage}
            composerFocused={dmComposerFocused}
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
            collectQuestion={collectQuestion}
            collectAllowSkip={collectAllowSkip}
            collectCustomProperty={customProperty}
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
      </div>

      {showCustomPropertyDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  Create custom property
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  Ask a question and choose how followers should answer.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCustomPropertyDialog(false)}
                className="rounded-full p-1 text-muted-foreground hover:bg-muted"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div className="space-y-1">
                <Label className="text-[11px]">Property name</Label>
                <Input
                  value={customDraft.key}
                  onChange={(event) =>
                    setCustomDraft((current) => ({
                      ...current,
                      key: event.target.value,
                    }))
                  }
                  placeholder="e.g. company"
                  className="h-9 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Question</Label>
                <Input
                  value={customDraft.question}
                  onChange={(event) =>
                    setCustomDraft((current) => ({
                      ...current,
                      question: event.target.value,
                    }))
                  }
                  placeholder="e.g. What is your company name?"
                  className="h-9 text-xs"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-[11px]">Answer type</Label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: "options", label: "Options", hint: "Pick from a list" },
                    { value: "yes_no", label: "Yes / No", hint: "Two choices" },
                    { value: "text", label: "Text", hint: "Type anything" },
                  ].map((type) => (
                    <button
                      key={type.value}
                      type="button"
                      onClick={() =>
                        setCustomDraft((current) => ({
                          ...current,
                          type: type.value as "options" | "yes_no" | "text",
                        }))
                      }
                      className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                        customDraft.type === type.value
                          ? "border-[#6a06e4] bg-[#6a06e4]/10"
                          : "border-[#e0e2e8] hover:bg-muted/40 dark:border-border"
                      }`}
                    >
                      <span className="block text-xs font-semibold text-foreground">
                        {type.label}
                      </span>
                      <span className="block text-[10px] text-muted-foreground">
                        {type.hint}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              {customDraft.type === "options" && (
                <div className="space-y-2">
                  <Label className="text-[11px]">Options</Label>
                  {customDraft.options.map((option, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        value={option}
                        onChange={(event) =>
                          setCustomDraft((current) => ({
                            ...current,
                            options: current.options.map((item, i) =>
                              i === index ? event.target.value : item
                            ),
                          }))
                        }
                        placeholder={`Option ${index + 1}`}
                        className="h-9 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setCustomDraft((current) => ({
                            ...current,
                            options: current.options.filter(
                              (_, i) => i !== index
                            ),
                          }))
                        }
                        disabled={customDraft.options.length <= 2}
                        aria-label={`Remove option ${index + 1}`}
                        className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-40"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setCustomDraft((current) => ({
                        ...current,
                        options: [...current.options, ""],
                      }))
                    }
                    className="text-[11px] font-semibold text-[#6a06e4]"
                  >
                    + Add option
                  </button>
                </div>
              )}
              {customDraft.type === "yes_no" && (
                <div className="space-y-2">
                  <Label className="text-[11px]">Follower sees</Label>
                  <div className="flex gap-2">
                    <span className="rounded-lg border border-[#e0e2e8] px-3 py-1.5 text-xs font-medium dark:border-border">
                      Yes
                    </span>
                    <span className="rounded-lg border border-[#e0e2e8] px-3 py-1.5 text-xs font-medium dark:border-border">
                      No
                    </span>
                  </div>
                </div>
              )}
              {customDraft.type === "text" && (
                <div className="space-y-2">
                  <Label className="text-[11px]">Follower sees</Label>
                  <div className="rounded-lg border border-[#e0e2e8] px-3 py-2 text-xs text-muted-foreground dark:border-border">
                    A text input to type their answer
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowCustomPropertyDialog(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={
                  !customDraft.key.trim() ||
                  !customDraft.question.trim() ||
                  (customDraft.type === "options" &&
                    customDraft.options.filter((option) => option.trim()).length <
                      2)
                }
                onClick={() => {
                  const key = customDraft.key
                    .trim()
                    .toLowerCase()
                    .replace(/[^a-z0-9_]+/g, "_")
                    .replace(/^_+|_+$/g, "");
                  const options = customDraft.options
                    .map((option) => option.trim())
                    .filter(Boolean);
                  const property = {
                    key,
                    question: customDraft.question.trim(),
                    type: customDraft.type,
                    options,
                  };
                  setCustomProperty(property);
                  setCollectField("custom");
                  setCollectCustomKey(key);
                  setCollectQuestion(property.question);
                  setShowCustomPropertyDialog(false);
                }}
              >
                Save property
              </Button>
            </div>
          </div>
        </div>
      )}

      {showLinkDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(60,60,60,0.45)] p-4">
          <div className="w-full max-w-[512px] overflow-hidden rounded-[24px] border border-[#e5e7eb] bg-[#fcfefd] shadow-[0px_4px_10px_-1px_rgba(190,193,214,0.25)]">
            <div className="p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[18px] font-semibold leading-7 text-[#1d2842]">
                  Add Link
                </h3>
                <button
                  type="button"
                  onClick={() => setShowLinkDialog(false)}
                  className="grid size-6 place-items-center rounded-md text-[#8c919f] hover:bg-muted"
                  aria-label="Close"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="mt-4 overflow-hidden rounded-[10px] border border-[#e8ecec]">
                <div className="flex h-10 items-center gap-2 border-b border-[#d4d9d9] bg-[#fcfefd] px-3">
                  <Type className="size-4 shrink-0 text-[#8c919f]" />
                  <input
                    value={linkDraft.title}
                    onChange={(event) =>
                      setLinkDraft((current) => ({
                        ...current,
                        title: event.target.value,
                      }))
                    }
                    placeholder="Enter Title"
                    className="min-w-0 flex-1 bg-transparent text-sm text-[#1d2842] outline-none placeholder:text-[#99a1af]"
                  />
                  <span className="shrink-0 text-[11px] text-[#99a1af]">
                    Open Link
                  </span>
                </div>
                <div className="flex h-10 items-center gap-2 bg-[#fafafa] px-3">
                  <Link2 className="size-4 shrink-0 text-[#8c919f]" />
                  <input
                    value={linkDraft.url}
                    onChange={(event) =>
                      setLinkDraft((current) => ({
                        ...current,
                        url: event.target.value,
                      }))
                    }
                    placeholder="Enter Link"
                    className="min-w-0 flex-1 bg-transparent text-sm text-[#1d2842] outline-none placeholder:text-[#99a1af]"
                  />
                  <span className="shrink-0 text-[11px] text-[#99a1af]">
                    https://example.com
                  </span>
                </div>
              </div>

              <button
                type="button"
                disabled={!linkDraft.url.trim()}
                onClick={() => {
                  const title = linkDraft.title.trim();
                  const url = linkDraft.url.trim();
                  if (!url) return;
                  const next =
                    editingLinkIndex === null
                      ? [...links, { title, url }]
                      : links.map((item, i) =>
                          i === editingLinkIndex ? { title, url } : item
                        );
                  setLinks(next);
                  const first = next.find((item) => item.url.trim());
                  setButtonText(first?.title.trim() || "Open link");
                  setButtonUrl(first?.url.trim() || "");
                  setShowLinkDialog(false);
                }}
                className="mt-3 h-9 w-full rounded-[10px] bg-[#6a06e4] text-[15px] font-semibold text-[#e5e5e5] transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                Add Link
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
