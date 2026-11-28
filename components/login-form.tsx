"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { Turnstile } from "@/components/auth/turnstile";
import { checkAuthRateLimit } from "@/lib/auth-guard";
import { safeNextPath } from "@/lib/safe-redirect";
import { safeDecodeURIComponent } from "@/lib/safe-decode";
import posthog from "posthog-js";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextTarget = searchParams.get("next") || searchParams.get("callbackUrl");
  // Sanitize the post-login target once. A protocol-relative, absolute, or
  // javascript: value falls back to /onboarding. The same sanitized value is
  // used for the password redirect, the magic link, and the OAuth redirect.
  const callbackUrl = safeNextPath(nextTarget, "https://app.local");
  const signUpUrl = nextTarget
    ? `/auth/sign-up?next=${encodeURIComponent(callbackUrl)}`
    : "/auth/sign-up";
  const urlError = searchParams.get("error");
  const decodedError: string | null = urlError
    ? safeDecodeURIComponent(urlError)
    : null;

  const [authMode, setAuthMode] = useState<"password" | "magic-link">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorInfo, setErrorInfo] = useState<{ title: string; description: string } | null>(
    urlError
      ? {
          title: "Sign-in notice",
          description: decodedError ?? urlError,
        }
      : null
  );
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);

  const handlePasswordLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorInfo(null);

    const guard = await checkAuthRateLimit("login");
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
        description: "Please complete the CAPTCHA challenge before signing in.",
      });
      setIsLoading(false);
      return;
    }

    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
        options: { captchaToken: captchaToken ?? undefined },
      });

      if (error) {
        throw error;
      }

      if (data?.user) {
        posthog.capture("user_signed_in", {
          method: "password",
          user_id: data.user.id,
        });
      }

      if (typeof window !== "undefined") {
        window.location.href = callbackUrl;
      } else {
        router.push(callbackUrl);
        router.refresh();
      }
    } catch (err: unknown) {
      setCaptchaResetKey((key) => key + 1);
      const rawMessage = err instanceof Error ? err.message : "Failed to sign in";
      let title = "Sign-in failed";
      let description = rawMessage;

      const lower = rawMessage.toLowerCase();
      if (lower.includes("email not confirmed")) {
        title = "Email not confirmed";
        description =
          "Your email has not been confirmed yet. Check your inbox (including Spam/Junk) for the confirmation link, then try again.";
      } else if (lower.includes("invalid login credentials")) {
        title = "Invalid credentials";
        description = "Incorrect email or password. Please try again or click 'Forgot password?' below.";
      }

      setErrorInfo({
        title,
        description,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleMagicLink = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorInfo(null);

    const guard = await checkAuthRateLimit("magic-link");
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
        description: "Please complete the CAPTCHA challenge before requesting a link.",
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
      const emailRedirectTo = `${origin}/auth/confirm?next=${encodeURIComponent(callbackUrl)}`;

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo,
          captchaToken: captchaToken ?? undefined,
        },
      });

      if (error) {
        throw error;
      }

      setMagicLinkSent(true);
    } catch (err: unknown) {
      setCaptchaResetKey((key) => key + 1);
      const message = err instanceof Error ? err.message : "Failed to send magic link";
      setErrorInfo({
        title: "Magic link failed",
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
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">Sign in</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Sign in to manage your Instagram comment-to-DM automations and campaigns.
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

      {/* Magic link confirmation */}
      {magicLinkSent ? (
        <div className="mt-6 rounded-lg border border-primary/20 bg-primary/5 p-5 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Mail className="h-5 w-5" />
          </div>
          <h2 className="mt-3 text-base font-medium text-foreground">Check your email</h2>
          <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
            We sent a secure sign-in link to <span className="font-medium text-foreground">{email}</span>. Click it to log in immediately.
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-4 text-xs"
            onClick={() => setMagicLinkSent(false)}
          >
            Use a different sign-in method
          </Button>
        </div>
      ) : (
        <div className="mt-8 space-y-5">
          {/* OAuth Providers */}
          <OAuthButtons
            callbackUrl={callbackUrl}
            onError={(msg) =>
              setErrorInfo({
                title: "Sign-in failed",
                description: msg,
              })
            }
          />

          {/* Divider */}
          <div className="flex items-center gap-3 py-1">
            <Separator className="flex-1" />
            <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              or continue with email
            </span>
            <Separator className="flex-1" />
          </div>

          {/* Form */}
          {authMode === "password" ? (
            <form onSubmit={handlePasswordLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-10"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <Link
                    href="/auth/forgot-password"
                    className="text-xs text-muted-foreground underline-offset-4 hover:underline hover:text-foreground"
                  >
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type="password"
                    required
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-10"
                  />
                </div>
              </div>

              <Turnstile
                onToken={setCaptchaToken}
                resetKey={captchaResetKey}
                action="login"
              />

              <Button type="submit" size="lg" className="w-full h-10 font-medium" disabled={isLoading}>
                {isLoading ? "Signing in..." : "Sign in with Password"}
                {!isLoading && <ArrowRight className="ml-2 h-4 w-4" />}
              </Button>

              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode("magic-link");
                    setCaptchaToken(null);
                    setCaptchaResetKey((key) => key + 1);
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
                >
                  Or sign in with passwordless magic link
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleMagicLink} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="magic-email">Work email</Label>
                <Input
                  id="magic-email"
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
                action="magic-link"
              />

              <Button type="submit" size="lg" className="w-full h-10 font-medium" disabled={isLoading}>
                {isLoading ? "Sending link..." : "Send Magic Link"}
                {!isLoading && <ArrowRight className="ml-2 h-4 w-4" />}
              </Button>

              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode("password");
                    setCaptchaToken(null);
                    setCaptchaResetKey((key) => key + 1);
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
                >
                  Or sign in with email and password
                </button>
              </div>
            </form>
          )}

          {/* Toggle to Sign Up */}
          <div className="pt-2 text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link
              href={signUpUrl}
              suppressHydrationWarning
              className="font-medium text-foreground underline underline-offset-4 hover:text-primary transition-colors"
            >
              Sign up
            </Link>
          </div>
        </div>
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
