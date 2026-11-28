import type { MessageFormat, StoredAsset } from "@/lib/message-formats";

/**
 * Everything the campaign builder needs to restore an in-progress edit.
 *
 * This is intentionally a plain, JSON-serialisable snapshot. It is stored in
 * localStorage so a creator can close the tab without losing their work, and
 * it is cleared as soon as the campaign is published.
 */
export interface CampaignDraftState {
  name: string;
  triggerType: "COMMENT" | "SHARE_TO_DM";
  postScope: "ANY_POST" | "SPECIFIC_POST" | "NEXT_POST";
  selectedPost: {
    id: string;
    caption: string;
    thumbnailUrl: string;
  } | null;
  keywords: string[];
  anyKeyword: boolean;
  dmMessage: string;
  dmVariants: string[];
  messageFormat: MessageFormat;
  messageAsset: StoredAsset | null;
  shortLinksEnabled: boolean;
  linkRotatorId: string | null;
  buttonText: string;
  buttonUrl: string;
  collectField: string;
  collectCustomKey: string;
  collectQuestion: string;
  collectAllowSkip: boolean;
  customProperty: {
    key: string;
    question: string;
    type: "options" | "yes_no" | "text";
    options: string[];
  } | null;
  collectRetryMessage: string;
  collectSkipMessage: string;
  collectSuccessMessage: string;
  collectSkipKeywords: string;
  collectMaxAttempts: number;
  hourlyCap: number;
  publicReplyEnabled: boolean;
  publicReplyMessages: string[];
  publicReplyLimit: number;
  followGateEnabled: boolean;
  openingMessage: string;
  followGateButtonLabel: string;
  followGateOnUnavailable: "hold" | "deliver";
  links: Array<{ title: string; url: string }>;
}

export interface CampaignDraft {
  version: 1;
  savedAt: number;
  state: CampaignDraftState;
}

const STORAGE_PREFIX = "dmplease:campaign-draft:v1:";

function storageKey(key: string) {
  return `${STORAGE_PREFIX}${key}`;
}

export function loadCampaignDraft(key: string): CampaignDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CampaignDraft> | null;
    if (!parsed || parsed.version !== 1 || !parsed.state) return null;
    return parsed as CampaignDraft;
  } catch {
    return null;
  }
}

export function saveCampaignDraft(
  key: string,
  state: CampaignDraftState
): number | null {
  if (typeof window === "undefined") return null;
  try {
    const savedAt = Date.now();
    const draft: CampaignDraft = { version: 1, savedAt, state };
    window.localStorage.setItem(storageKey(key), JSON.stringify(draft));
    return savedAt;
  } catch {
    // Storage can be full or blocked (private mode). Autosave is best-effort.
    return null;
  }
}

export function clearCampaignDraft(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(key));
  } catch {
    // Ignore storage failures.
  }
}
