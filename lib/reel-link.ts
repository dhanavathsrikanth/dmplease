/**
 * Shared vocabulary for "auto-attach the reel link" behaviour.
 *
 * This module is deliberately client-safe: the campaign builder and the
 * server-side resolver both import it, so it must not pull in Redis, Meta or
 * any other server-only dependency.
 */

/**
 * Value stored in `automations.button_url` when the destination URL is not
 * known at setup time and must be resolved when a comment actually arrives.
 * It mirrors the `{link}` placeholder creators already use in DM templates.
 */
export const AUTO_REEL_LINK = "{permalink}";

/** Human-readable description used in the campaign builder UI. */
export const AUTO_REEL_LINK_LABEL = "Auto-attaches the new reel's permalink";

export function isAutoReelLink(value: string | null | undefined): boolean {
  return (value ?? "").trim().toLowerCase() === AUTO_REEL_LINK.toLowerCase();
}

/**
 * Whether an automation should send the triggering post's real permalink.
 *
 * A NEXT_POST campaign cannot know its URL before the upload exists, so an
 * empty destination URL means "auto" for that scope. An explicit static URL
 * always wins — both for backwards compatibility and for creators who want to
 * send people somewhere else.
 */
export function usesReelPermalink(auto: {
  postScope?: string | null;
  buttonUrl?: string | null;
}): boolean {
  if (isAutoReelLink(auto.buttonUrl)) return true;
  return auto.postScope === "NEXT_POST" && !(auto.buttonUrl ?? "").trim();
}
