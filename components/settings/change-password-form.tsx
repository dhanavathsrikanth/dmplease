"use client";

import { useState } from "react";
import { Check, KeyRound, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { checkAuthRateLimit } from "@/lib/auth-guard";
import { passwordPolicyHint, validatePassword } from "@/lib/password-policy";

/**
 * Change password for a signed-in user. Requires the current password, which
 * Supabase validates when "Require current password when changing password" is
 * enabled in the Auth settings. The reset flow stays separate because a user
 * who forgot their password cannot supply it.
 */
export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

    setBusy(true);
    try {
      const guard = await checkAuthRateLimit("password-change");
      if (!guard.allowed) {
        setError(guard.error || "Too many attempts. Please wait and try again.");
        return;
      }

      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({
        current_password: currentPassword,
        password: newPassword,
      });

      if (updateError) {
        setError(updateError.message);
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setNotice("Password updated.");
    } catch {
      setError("Network error while updating your password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Change the password for your signed-in account. You must enter your
        current password first.
      </p>

      <div className="space-y-1.5">
        <Label htmlFor="current-password" className="text-[11px]">
          Current password
        </Label>
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
