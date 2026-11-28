"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, KeyRound, Loader2, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Turnstile } from "@/components/auth/turnstile";
import { changePasswordWithCurrentPassword } from "@/app/dashboard/settings/password-actions";
import { checkAuthRateLimit } from "@/lib/auth-guard";
import { passwordPolicyHint, validatePassword } from "@/lib/password-policy";

interface ChangePasswordFormProps {
  /**
   * False for accounts that only sign in through a connected provider. Those
   * accounts have no current password to verify, so the form is replaced with
   * a pointer to the recovery flow.
   */
  hasPasswordIdentity?: boolean;
}

/**
 * Change password for a signed-in user.
 *
 * The current password is verified server-side by the action, not just sent to
 * Supabase. That keeps the control real even when the project-level "Require
 * current password when changing password" setting is off. The reset flow
 * stays separate because a user who forgot their password cannot supply it.
 */
export function ChangePasswordForm({
  hasPasswordIdentity = true,
}: ChangePasswordFormProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (!currentPassword) {
      setError("Enter your current password.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("The new passwords do not match.");
      return;
    }

    const policy = validatePassword(newPassword);
    if (!policy.valid) {
      setError(`Use a stronger password: ${policy.errors.join(", ")}.`);
      return;
    }

    if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !captchaToken) {
      setError("Complete the verification challenge before updating your password.");
      return;
    }

    setBusy(true);
    try {
      // Advisory only. This client-side limiter fails open and can be bypassed
      // by calling the Server Action directly. Supabase Auth's reauthentication
      // setting (plus the server action's own limiter and current-password
      // check) is the authoritative layer.
      const guard = await checkAuthRateLimit("password-change");
      if (!guard.allowed) {
        setError(guard.error || "Too many attempts. Please wait and try again.");
        return;
      }

      const result = await changePasswordWithCurrentPassword({
        currentPassword,
        newPassword,
        confirmPassword,
        captchaToken: captchaToken ?? undefined,
      });

      if (!result.success) {
        setCaptchaResetKey((key) => key + 1);
        setError(result.error || "Could not update your password.");
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setCaptchaResetKey((key) => key + 1);
      setNotice("Password updated. Other devices were signed out.");
    } catch {
      setCaptchaResetKey((key) => key + 1);
      setError("Network error while updating your password.");
    } finally {
      setBusy(false);
    }
  };

  if (!hasPasswordIdentity) {
    return (
      <div className="space-y-3">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          This account signs in with a connected provider and does not have a
          password yet. Set one from the recovery flow if you want to sign in
          with email as well.
        </p>
        <Button asChild size="sm" variant="outline" className="rounded-full h-8 text-[11px] font-semibold">
          <Link href="/auth/forgot-password">Set a password</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Change the password for your signed-in account. You must enter your
        current password first.
      </p>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="current-password" className="text-[11px]">
            Current password
          </Label>
          <Link
            href="/auth/forgot-password"
            className="text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Forgot it?
          </Link>
        </div>
        <Input
          id="current-password"
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          className="h-9 max-w-md text-xs"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="new-password" className="text-[11px]">
          New password
        </Label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          required
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          className="h-9 max-w-md text-xs"
        />
        <p className="text-[10px] text-muted-foreground">{passwordPolicyHint()}</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirm-new-password" className="text-[11px]">
          Confirm new password
        </Label>
        <Input
          id="confirm-new-password"
          type="password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          className="h-9 max-w-md text-xs"
        />
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-border/70 bg-muted/40 px-3 py-2.5">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Your current password is verified on the server. Other devices will be
          signed out after the change.
        </p>
      </div>

      <Turnstile
        onToken={setCaptchaToken}
        resetKey={captchaResetKey}
        action="password-change"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={busy}
          className="rounded-full h-8 text-[11px] font-semibold gap-1.5"
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <KeyRound className="size-3.5" aria-hidden="true" />
          )}
          Update password
        </Button>
        {notice && (
          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
            <Check className="size-3" aria-hidden="true" />
            {notice}
          </span>
        )}
      </div>

      {error && (
        <p role="alert" className="text-[11px] font-medium text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
