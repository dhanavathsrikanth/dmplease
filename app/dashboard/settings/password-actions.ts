"use server";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { checkServerAuthRateLimit } from "@/lib/auth/rate-limit";
import { clearRecoveryGrant } from "@/lib/auth/recovery-cookie";
import { validatePassword } from "@/lib/password-policy";

const changeSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password."),
  newPassword: z.string().min(1, "Enter a new password."),
  confirmPassword: z.string().min(1, "Confirm your new password."),
  captchaToken: z.string().optional(),
});

export interface ChangePasswordResult {
  success: boolean;
  error?: string;
}

/**
 * Changes the password of a signed-in user after verifying the current one.
 *
 * Supabase's "Require current password when changing password" setting is a
 * project-level toggle, so the app cannot assume it is on. This action proves
 * the current password itself by attempting a credential sign-in on an
 * isolated client that never touches the session cookies. The field is
 * therefore a real control, not decoration, regardless of the dashboard
 * setting. The setting is currently enabled as defense-in-depth, and the
 * update also sends `current_password` so GoTrue accepts it.
 */
export async function changePasswordWithCurrentPassword(
  input: z.input<typeof changeSchema>
): Promise<ChangePasswordResult> {
  const parsed = changeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Invalid password.",
    };
  }

  const { currentPassword, newPassword, confirmPassword, captchaToken } =
    parsed.data;

  if (newPassword !== confirmPassword) {
    return { success: false, error: "The new passwords do not match." };
  }

  const policy = validatePassword(newPassword);
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
    return { success: false, error: "You must be signed in to change your password." };
  }

  const hasEmailIdentity = (user.identities ?? []).some(
    (identity) => identity.provider === "email"
  );
  if (!hasEmailIdentity || !user.email) {
    return {
      success: false,
      error:
        "This account does not use a password. Use 'Forgot password' to set one, or continue signing in with your connected provider.",
    };
  }

  const guard = await checkServerAuthRateLimit("password-change", user.id, 10);
  if (!guard.allowed) {
    return { success: false, error: guard.error };
  }

  // Verify the current password on a throwaway client. It has no cookie
  // storage, so a successful check cannot rotate or replace the real session.
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      "";

    const verifier = createSupabaseClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const { error: verifyError } = await verifier.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
      options: { captchaToken: captchaToken ?? undefined },
    });

    if (verifyError) {
      const message = verifyError.message.toLowerCase();
      if (message.includes("captcha")) {
        return {
          success: false,
          error: "Verification failed. Complete the challenge and try again.",
        };
      }
      if (message.includes("rate limit") || verifyError.status === 429) {
        return {
          success: false,
          error: "Too many attempts. Please wait a few minutes and try again.",
        };
      }
      return { success: false, error: "Your current password is incorrect." };
    }
  } catch (error) {
    console.error("[change-password] Reauthentication failed:", error);
    return {
      success: false,
      error: "Could not verify your current password. Please try again.",
    };
  }

  const { error: updateError } = await supabase.auth.updateUser({
    password: newPassword,
    // Send it as well so the call still succeeds when the project-level
    // "Require current password when changing password" setting is enabled.
    // The check above is what makes the control independent of that setting.
    current_password: currentPassword,
  });

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  // A password change invalidates any recovery grant that may still be open in
  // another tab. The cookie is path-scoped, so this only clears that grant.
  try {
    await clearRecoveryGrant();
  } catch (clearError) {
    console.error("[change-password] Could not clear recovery grant:", clearError);
  }

  // A password change should invalidate sessions on other devices. Supabase
  // Auth's reauthentication setting is the authoritative layer for this flow;
  // the client-side limiter in the form is advisory only. `scope: "others"`
  // keeps the current session so the user is not signed out of this tab.
  try {
    await supabase.auth.signOut({ scope: "others" });
  } catch (signOutError) {
    console.error(
      "[change-password] Could not revoke other sessions:",
      signOutError
    );
  }

  return { success: true };
}
