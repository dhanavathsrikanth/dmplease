/**
 * Documented Meta platform limits that shape the safety engine.
 *
 * Source: Meta Messenger Platform rate limits
 * https://developers.facebook.com/documentation/business-messaging/messenger-platform/overview/rate-limiting
 *
 * These are the ceilings Meta enforces per Instagram Professional account.
 * The safety engine stays well below them so a viral spike never produces a
 * 429 or a temporary messaging block.
 */

/** Private replies to comments on posts/reels, per Instagram account. */
export const META_PRIVATE_REPLIES_PER_HOUR = 750;

/** Private replies to Instagram Live comments, per account. */
export const META_LIVE_PRIVATE_REPLIES_PER_SECOND = 100;

/** Send API: text, links, reactions and stickers, per account. */
export const META_SEND_TEXT_PER_SECOND = 300;

/** Send API: audio or video content, per account. */
export const META_SEND_MEDIA_PER_SECOND = 10;

/** Conversations API (reading threads), per account. */
export const META_CONVERSATIONS_PER_SECOND = 2;

/**
 * High-volume inbox protection: once an account sends and receives more than
 * this many messages, Meta stops showing/sending new messages until volume
 * drops. We treat it as a hard ceiling for proactive throttling.
 */
export const META_HIGH_VOLUME_MESSAGES = 72_000;

/** Standard messaging window opened by a user action (hours). */
export const META_STANDARD_WINDOW_HOURS = 24;

/** Human Agent tag window for manual replies (days). */
export const META_HUMAN_AGENT_WINDOW_DAYS = 7;

/**
 * Safe default hourly cap for a single automation. Meta allows 750 private
 * replies/hour per account; we default each automation to a fraction so
 * multiple campaigns cannot collectively exceed the account ceiling.
 */
export const SAFE_DEFAULT_HOURLY_CAP = 200;

/**
 * Account-level hard ceiling used by the safety engine. Slightly below Meta's
 * 750/hour so retries and manual replies still have headroom.
 */
export const ACCOUNT_HOURLY_CEILING = 700;

/** Default randomized pre-send delay range (milliseconds). */
export const DEFAULT_DELAY_MIN_MS = 0;
export const DEFAULT_DELAY_MAX_MS = 2_000;

/** Maximum configurable pre-send delay (milliseconds). */
export const MAX_DELAY_MS = 60_000;
