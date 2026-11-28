"use server";

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import {
  clearRecoveryGrant,
  readRecoveryGrant,
  recoveryGrantMatches,
} from "@/lib/auth/recovery-cookie";
import { checkServerAuthRateLimit } from "@/lib/auth/rate-limit";
import { validatePassword } from "@/lib/password-policy";

const updateSchema = z.object({
  password: z.string().min(1, "Enter a new password."),
  confirmPassword: z.string().min(1, "Confirm your new password."),
});

export interface UpdateRecoveredPasswordResult {
  success: boolean;
  error?: string;
}

/**
 * Completes a password recovery.
 *
 * Authorization is the recovery grant, not the ambient session: the grant is
 * only issued by /auth/confirm after a recovery email exchange, is bound to
 * the user id, expires quickly and is cleared after use. This keeps the
 * recovery path independent of the Supabase "require current password"
 * project setting, which a normal session could otherwise rely on. Supabase
 * exempts recovery sessions from that setting (`Session.IsRecovery()` in
 * GoTrue), so the update succeeds even when the setting is enabled.
 */
export async function updateRecoveredPassword(
  input: z.input<typeof updateSchema>
): Promise<UpdateRecoveredPasswordResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Invalid password.",
    };
  }

  const { password, confirmPassword } = parsed.data;

  if (password !== confirmPassword) {
    return { success: false, error: "The passwords do not match." };
  }

  const policy = validatePassword(password);
  if (!policy.valid) {
    return {
      success: false,
      error: `Use a stronger password: ${policy.errors.join(", ")}.`,
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      success: false,
      error: "Your recovery link has expired. Request a new one.",
    };
  }

  const grant = await readRecoveryGrant();
  if (!recoveryGrantMatches(grant, user.id)) {
    return {
      success: false,
      error:
        "This page is only available from a password reset email. Request a new link to continue.",
    };
  }

  const guard = await checkServerAuthRateLimit(
    "password-recovery",
    user.id,
    10
  );
  if (!guard.allowed) {
    return { success: false, error: guard.error };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("current password")) {
      return {
        success: false,
        error:
          "This recovery link can no longer be used to change your password. Sign in and use Settings → Password, or request a new reset link.",
      };
    }
    return { success: false, error: error.message };
  }

  // The grant is single-use from the app's perspective: remove it before the
  // redirect so a refresh cannot replay the recovery page.
  try {
    await clearRecoveryGrant();
  } catch (clearError) {
    console.error("[password-recovery] Could not clear recovery grant:", clearError);
  }

  // A password reset is the canonical "I may have been compromised" action.
  // Keep this browser signed in but revoke every other refresh token.
  try {
    await supabase.auth.signOut({ scope: "others" });
  } catch (signOutError) {
    console.error(
      "[password-recovery] Could not revoke other sessions:",
      signOutError
    );
  }

  return { success: true };
}
