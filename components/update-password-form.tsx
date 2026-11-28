"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";

import { updateRecoveredPassword } from "@/app/auth/update-password/actions";
import { checkAuthRateLimit } from "@/lib/auth-guard";
import { passwordPolicyHint, validatePassword } from "@/lib/password-policy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface UpdatePasswordFormProps {
  /** Email of the account being recovered, shown so the user can confirm it. */
  email?: string | null;
}

export function UpdatePasswordForm({ email }: UpdatePasswordFormProps) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorInfo, setErrorInfo] = useState<{ title: string; description: string } | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleUpdatePassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorInfo(null);

    if (password !== confirmPassword) {
      setErrorInfo({
        title: "Passwords do not match",
        description: "Please make sure both passwords match before updating.",
      });
      setIsLoading(false);
      return;
    }

    const policy = validatePassword(password);
    if (!policy.valid) {
      setErrorInfo({
        title: "Password too weak",
        description: `Use a stronger password: ${policy.errors.join(", ")}.`,
      });
      setIsLoading(false);
      return;
    }

    const guard = await checkAuthRateLimit("password-change");
    if (!guard.allowed) {
      setErrorInfo({
        title: "Too many attempts",
        description: guard.error || "Please wait a few minutes and try again.",
      });
      setIsLoading(false);
      return;
    }

    try {
      const result = await updateRecoveredPassword({
        password,
        confirmPassword,
      });

      if (!result.success) {
        setErrorInfo({
          title: "Update failed",
          description: result.error || "Failed to update password.",
        });
        return;
      }

      setIsSuccess(true);
      setTimeout(() => {
        router.push("/dashboard");
        router.refresh();
      }, 1800);
    } catch {
      setErrorInfo({
        title: "Update failed",
        description: "Network error while updating your password. Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-sm">
      {/* Logo */}
      <div className="mb-8">
        <Link href="/" className="inline-block transition-opacity hover:opacity-85">
          <Image
            src="/logo3.svg"
            width={38}
            height={42}
            alt="dmplease"
            unoptimized
            className="h-10 w-auto"
          />
        </Link>
      </div>

      {/* Heading */}
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">Update password</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {email ? (
          <>
            Set a new secure password for <span className="font-medium text-foreground">{email}</span>.
          </>
        ) : (
          "Set a new secure password for your account."
        )}
      </p>

      {/* Error Info Box */}
      {errorInfo && (
        <div className="mt-5 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm leading-6">
          <p className="font-semibold text-destructive">{errorInfo.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {errorInfo.description}
          </p>
        </div>
      )}

      {isSuccess ? (
        <div className="mt-6 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-5 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <h2 className="mt-3 text-base font-medium text-foreground">Password updated</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Your password was changed and your other devices were signed out. Redirecting you to
            your account...
          </p>
        </div>
      ) : (
        <form onSubmit={handleUpdatePassword} className="mt-8 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              required
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-10"
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {passwordPolicyHint()}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm-new-password">Confirm new password</Label>
            <Input
              id="confirm-new-password"
              type="password"
              required
              autoComplete="new-password"
              placeholder="Repeat your new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="h-10"
            />
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-border/70 bg-muted/40 px-3 py-2.5">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              For your security, all other sessions will be signed out after the change.
            </p>
          </div>

          <Button type="submit" size="lg" className="w-full h-10 font-medium" disabled={isLoading}>
            {isLoading ? "Saving..." : "Update Password"}
            {!isLoading && <ArrowRight className="ml-2 h-4 w-4" />}
          </Button>

          <div className="pt-1 text-center">
            <Link
              href="/auth/login"
              className="inline-flex items-center text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              Back to sign in
            </Link>
          </div>
        </form>
      )}

      {/* Footer */}
      <p className="mt-8 text-xs text-center text-muted-foreground">
        By continuing, you agree to our{" "}
        <Link href="/terms" className="underline underline-offset-2 hover:text-foreground">
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
          Privacy Policy
        </Link>
        .
      </p>
    </div>
  );
}
