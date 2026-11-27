"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Turnstile } from "@/components/auth/turnstile";
import { checkAuthRateLimit } from "@/lib/auth-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorInfo, setErrorInfo] = useState<{ title: string; description: string } | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);

  const handleResetPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorInfo(null);

    const guard = await checkAuthRateLimit("reset");
    if (!guard.allowed) {
      setErrorInfo({
        title: "Too many attempts",
        description: guard.error || "Please wait a few minutes and try again.",
      });
      setIsLoading(false);
      return;
    }

    if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !captchaToken) {
      setErrorInfo({
        title: "Complete the verification",
        description: "Please complete the CAPTCHA challenge before requesting a reset link.",
      });
      setIsLoading(false);
      return;
    }

    try {
      const supabase = createClient();
      const origin =
        typeof window !== "undefined"
          ? window.location.origin
          : process.env.NEXT_PUBLIC_SITE_URL || "";
      const redirectTo = `${origin}/auth/confirm?next=${encodeURIComponent("/auth/update-password")}`;

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
        captchaToken: captchaToken ?? undefined,
      });

      if (error) {
        throw error;
      }

      setIsSuccess(true);
    } catch (err: unknown) {
      setCaptchaResetKey((key) => key + 1);
      const message = err instanceof Error ? err.message : "Failed to send reset link";
      setErrorInfo({
        title: "Reset failed",
        description: message,
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
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">Forgot password?</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Enter your email address and we&apos;ll send you a link to reset your password.
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
        <div className="mt-6 rounded-lg border border-primary/20 bg-primary/5 p-5 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Mail className="h-5 w-5" />
          </div>
          <h2 className="mt-3 text-base font-medium text-foreground">Password reset email sent</h2>
          <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
            If an account exists for <span className="font-medium text-foreground">{email}</span>, you will receive instructions on how to reset your password shortly.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-4 text-xs">
            <Link href="/auth/login">Back to Sign In</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={handleResetPassword} className="mt-8 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="reset-email">Email address</Label>
            <Input
              id="reset-email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-10"
            />
          </div>

          <Turnstile
            onToken={setCaptchaToken}
            resetKey={captchaResetKey}
            action="reset"
          />

          <Button type="submit" size="lg" className="w-full h-10 font-medium" disabled={isLoading}>
            {isLoading ? "Sending link..." : "Send Reset Link"}
            {!isLoading && <ArrowRight className="ml-2 h-4 w-4" />}
          </Button>

          <div className="pt-2 text-center">
            <Link
              href="/auth/login"
              className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              Return to sign in
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
