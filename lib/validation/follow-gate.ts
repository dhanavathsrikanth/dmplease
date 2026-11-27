/**
 * Shared validation for the "Ask for Follow" copy.
 *
 * Campaigns, inbox/story/share rules and the account fallback all accept the
 * same two fields. Keeping the limits here means the UI, server actions and
 * runtime normalisation cannot drift apart.
 */

import { z } from "zod";

import { FOLLOW_GATE_LIMITS } from "@/lib/follow-gate-constants";

/** Copy shown before Meta can verify that the person follows the account. */
export const openingMessageSchema = z
  .string()
  .trim()
  .max(
    FOLLOW_GATE_LIMITS.openingMessage,
    `Keep the opening message under ${FOLLOW_GATE_LIMITS.openingMessage} characters`
  );

/** Meta caps button titles at 20 characters. */
export const followGateButtonLabelSchema = z
  .string()
  .trim()
  .max(
    FOLLOW_GATE_LIMITS.buttonLabel,
    `Keep the button label under ${FOLLOW_GATE_LIMITS.buttonLabel} characters`
  );
