/**
 * Opening DM copy — the message sent before Meta can verify follow status.
 *
 * Pure module: no database, no Graph client, no framework imports. It is the
 * single source of truth for normalising stored copy and rendering the final
 * text. The webhook processor owns sending and persistence; tests can exercise
 * copy behaviour without mocking any I/O.
 */

import {
  FOLLOW_GATE_DEFAULTS,
  FOLLOW_GATE_LIMITS,
} from "@/lib/follow-gate-constants";
import { formatDmText } from "@/lib/meta/dm-template";
import { buildDmVars, renderDmTemplate, type DmVars } from "@/lib/dm-variables";

/**
 * Canonical copy used for one opening DM.
 *
 * `openingMessage` intentionally matches the `FollowGateConfig` property name
 * so existing callers and tests can pass either shape without conversion.
 */
export interface OpeningDmTemplate {
  /** Raw template. Supports {username}, {keyword} and {link}. */
  openingMessage: string;
  /** Meta caps button titles; normalisation enforces the shared limit. */
  buttonLabel: string;
}

export type OpeningDmVars = DmVars;

/**
 * Turns optional/legacy stored values into usable copy. Empty strings fall
 * back to the shared defaults so older campaigns and direct DB writes still
 * render a sensible opener.
 */
export function normalizeOpeningTemplate(
  input?: { openingMessage?: string | null; buttonLabel?: string | null } | null
): OpeningDmTemplate {
  return {
    openingMessage:
      input?.openingMessage?.trim() || FOLLOW_GATE_DEFAULTS.openingMessage,
    buttonLabel:
      input?.buttonLabel?.trim()?.slice(0, FOLLOW_GATE_LIMITS.buttonLabel) ||
      FOLLOW_GATE_DEFAULTS.buttonLabel,
  };
}

/** Replaces supported placeholders in an opening message template. */
export function buildOpeningText(
  template: OpeningDmTemplate,
  vars: OpeningDmVars
): string {
  return renderDmTemplate(template.openingMessage, {
    ...buildDmVars(vars),
    // Opening messages historically read "get this" when no keyword exists.
    keyword: vars.keyword?.trim() || "this",
  }).trim();
}

/**
 * Final text ready for the Graph API. Reusing formatDmText keeps URL handling
 * identical to the guide DM (bare URLs on their own line, clickable in IG).
 */
export function renderOpeningDm(
  template: OpeningDmTemplate,
  vars: OpeningDmVars
): string {
  return formatDmText(buildOpeningText(template, vars), buildDmVars(vars));
}
