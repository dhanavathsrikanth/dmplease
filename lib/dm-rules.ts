/**
 * Pure, testable decision layer for DM keyword rules and "Respond to all DMs".
 *
 * No database, Redis or Meta imports. The webhook processor calls these
 * helpers so ordering, matching and fallback semantics are identical in every
 * runtime path and can be verified with unit tests.
 */

export interface DispatchRule {
  id: string;
  name: string;
  trigger_type: string;
  keywords: string[];
  message: string;
  variants: string[];
  button_text: string | null;
  button_url: string | null;
  collect_field: string | null;
  follow_gate_enabled: boolean;
  opening_message: string | null;
  follow_gate_button_label: string | null;
  follow_gate_on_unavailable: string | null;
  once_per_days: number;
  priority: number;
  short_links_enabled?: boolean | null;
  link_rotator_id?: string | null;
  delay_min_ms?: number;
  delay_max_ms?: number;
  hourly_cap?: number;
  collect_retry_message?: string | null;
  collect_skip_message?: string | null;
  collect_success_message?: string | null;
  collect_skip_keywords?: string[] | null;
  collect_max_attempts?: number | null;
}

export interface RuleSelection<T extends DispatchRule> {
  rule: T | null;
  matchedKeyword: string | null;
  /** True when the selected rule is an explicit "respond to all" catch-all. */
  catchAll: boolean;
}

/** A rule that matched, in dispatch order. Unlike `RuleSelection`, never null. */
export interface RuleCandidate<T extends DispatchRule> {
  rule: T;
  matchedKeyword: string | null;
  catchAll: boolean;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whole-token matching. Single words must match an entire token, multi-word
 * phrases match across whitespace. Case-insensitive and unicode-aware.
 */
export function matchesRuleKeyword(text: string, keyword: string): boolean {
  const needle = keyword.trim().replace(/\s+/g, " ");
  // A blank keyword is a misconfiguration, not a wildcard. Treating it as a
  // match would let an empty rule steal every DM from a real keyword rule.
  if (!needle) return false;

  const pattern = escapeRegex(needle).replace(/ /g, "\\s+");
  try {
    const regex = new RegExp(
      `(?<![\\p{L}\\p{N}_])${pattern}(?![\\p{L}\\p{N}_])`,
      "iu"
    );
    return regex.test(text.trim());
  } catch {
    return text.toLowerCase().includes(needle.toLowerCase());
  }
}

export function matchesRuleKeywords(keywords: string[], text: string): boolean {
  if (!keywords || keywords.length === 0) return true;
  return keywords.some((keyword) => matchesRuleKeyword(text, keyword));
}

/**
 * Keyword rules always win over catch-all rules. Within each group, higher
 * `priority` wins; ties fall back to stable insertion order (callers pass
 * rules sorted by created_at). This prevents an empty-keyword rule from
 * stealing a DM that has a specific keyword match.
 *
 * Returns every matching rule in dispatch order: specific keyword matches by
 * priority, then catch-alls by priority. Callers iterate this list so a rule
 * throttled by `once_per_days` does not block a lower-priority rule or the
 * catch-all.
 */
export function selectInboundRuleCandidates<T extends DispatchRule>(
  rules: T[],
  text: string
): RuleCandidate<T>[] {
  // Virtual account fallbacks are applied by the caller only when no stored
  // rule matched, so they must never participate in normal selection.
  const stored = rules.filter((rule) => rule.trigger_type !== "FALLBACK");
  const specific = stored.filter((rule) => (rule.keywords ?? []).length > 0);
  const catchAlls = stored.filter((rule) => (rule.keywords ?? []).length === 0);

  const candidates: RuleCandidate<T>[] = [];
  for (const rule of [...specific].sort((a, b) => b.priority - a.priority)) {
    const matched = (rule.keywords ?? []).find((keyword) =>
      matchesRuleKeyword(text, keyword)
    );
    if (matched) {
      candidates.push({ rule, matchedKeyword: matched, catchAll: false });
    }
  }
  for (const rule of [...catchAlls].sort((a, b) => b.priority - a.priority)) {
    candidates.push({ rule, matchedKeyword: null, catchAll: true });
  }
  return candidates;
}

/**
 * Picks the first candidate whose rule is not blocked (opted out or inside its
 * `once_per_days` window). Returns null when every candidate is blocked.
 */
export function pickDispatchableCandidate<T extends DispatchRule>(
  candidates: RuleCandidate<T>[],
  blockedRuleIds: ReadonlySet<string>
): RuleCandidate<T> | null {
  return candidates.find((candidate) => !blockedRuleIds.has(candidate.rule.id)) ?? null;
}

export function selectInboundRule<T extends DispatchRule>(
  rules: T[],
  text: string
): RuleSelection<T> {
  const [first] = selectInboundRuleCandidates(rules, text);
  return first ?? { rule: null, matchedKeyword: null, catchAll: false };
}

export interface FallbackRow {
  fallback_reply_enabled?: boolean | null;
  fallback_reply_message?: string | null;
  fallback_reply_variants?: string[] | null;
  fallback_once_per_days?: number | null;
  fallback_follow_gate_enabled?: boolean | null;
  fallback_opening_message?: string | null;
  fallback_follow_gate_button_label?: string | null;
  fallback_follow_gate_on_unavailable?: string | null;
  fallback_button_text?: string | null;
  fallback_button_url?: string | null;
  fallback_short_links_enabled?: boolean | null;
  fallback_link_rotator_id?: string | null;
}

export interface FallbackReplyConfig {
  enabled: boolean;
  message: string;
  variants: string[];
  oncePerDays: number;
  followGateEnabled: boolean;
  openingMessage: string | null;
  buttonLabel: string | null;
  onUnavailable: "hold" | "deliver";
  buttonText: string | null;
  buttonUrl: string | null;
  shortLinksEnabled: boolean;
  linkRotatorId: string | null;
}

export function normalizeFallbackReply(row?: FallbackRow | null): FallbackReplyConfig {
  return {
    enabled: Boolean(row?.fallback_reply_enabled),
    message: (row?.fallback_reply_message ?? "").trim(),
    variants: (row?.fallback_reply_variants ?? []).filter(Boolean),
    oncePerDays: Math.max(0, Number(row?.fallback_once_per_days ?? 45)),
    followGateEnabled: Boolean(row?.fallback_follow_gate_enabled),
    openingMessage: row?.fallback_opening_message ?? null,
    buttonLabel: row?.fallback_follow_gate_button_label ?? null,
    onUnavailable: row?.fallback_follow_gate_on_unavailable === "deliver" ? "deliver" : "hold",
    buttonText: row?.fallback_button_text ?? null,
    buttonUrl: row?.fallback_button_url ?? null,
  shortLinksEnabled: Boolean(row?.fallback_short_links_enabled),
  linkRotatorId: row?.fallback_link_rotator_id ?? null,
  };
}

/**
 * Builds a virtual rule for the account-level "Respond to all DMs" reply so it
 * goes through exactly the same gate, throttle, variant, logging and safety
 * path as a normal rule. It runs only after no real rule matched.
 */
export function fallbackAsRule(
  config: FallbackReplyConfig,
  accountId: string
): DispatchRule {
  return {
    id: `fallback:${accountId}`,
    name: "Respond to all DMs",
    trigger_type: "FALLBACK",
    keywords: [],
    message: config.message,
    variants: config.variants,
    button_text: config.buttonText,
    button_url: config.buttonUrl,
    collect_field: null,
    follow_gate_enabled: config.followGateEnabled,
    opening_message: config.openingMessage,
    follow_gate_button_label: config.buttonLabel,
    follow_gate_on_unavailable: config.onUnavailable,
    once_per_days: config.oncePerDays,
    short_links_enabled: config.shortLinksEnabled,
    link_rotator_id: config.linkRotatorId,
    // Always last: it is only reached when no keyword or catch-all rule matched.
    priority: -1,
  };
}
