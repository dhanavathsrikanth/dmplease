"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import posthog from "posthog-js";

export function SignUpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextTarget = searchParams.get("next") || searchParams.get("callbackUrl");
  const callbackUrl = nextTarget || "/onboarding";
  const signInUrl = nextTarget
    ? `/auth/login?next=${encodeURIComponent(nextTarget)}`
    : "/auth/login";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorInfo, setErrorInfo] = useState<{ title: string; description: string } | null>(null);

  const handleSignUp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorInfo(null);

    if (password !== repeatPassword) {
      setErrorInfo({
        title: "Passwords do not match",
        description: "Please make sure both passwords match before continuing.",
      });
      setIsLoading(false);
      return;
    }

    if (password.length < 6) {
      setErrorInfo({
        title: "Password too short",
        description: "Password must be at least 6 characters long.",
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

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo,
        },
      });

      if (error) {
        throw error;
      }

      if (data?.user) {
        posthog.capture("user_signed_up", {
          method: "password",
          user_id: data.user.id,
        });
      }

      // Check if user already exists (Supabase returns empty identities array for existing users)
      if (data?.user && data.user.identities && data.user.identities.length === 0) {
        setErrorInfo({
          title: "Account already exists",
          description: "An account with this email already exists. Please sign in instead.",
        });
        setIsLoading(false);
        return;
      }

      // If user is immediately confirmed (or email confirmations disabled), go straight to callbackUrl
      if (data?.session) {
        if (typeof window !== "undefined") {
          window.location.href = callbackUrl;
        } else {
          router.push(callbackUrl);
          router.refresh();
        }
        return;
      }

      // Try signing in immediately (in case user was auto-confirmed by database trigger)
      try {
        const { data: signInData } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (signInData?.session) {
          if (typeof window !== "undefined") {
            window.location.href = callbackUrl;
          } else {
            router.push(callbackUrl);
            router.refresh();
          }
          return;
        }
      } catch {
        // Fall through to confirmation screen
      }

      // Confirmation email required
      router.push(`/auth/sign-up-success?email=${encodeURIComponent(email)}`);
    } catch (err: unknown) {
      const rawMessage = err instanceof Error ? err.message : "Failed to create account";
      let title = "Sign-up failed";
      let description = rawMessage;

      const lower = rawMessage.toLowerCase();
      if (lower.includes("rate limit") || lower.includes("over_email_send_rate_limit")) {
        title = "Email rate limit reached";
        description =
          "Supabase's built-in email quota was reached (max 3 emails/hour on free tier). In your Supabase Dashboard under Authentication -> Providers -> Email, disable 'Confirm email' to enable instant signups without rate limits.";
      } else if (lower.includes("invalid") || lower.includes("email_address_invalid")) {
        title = "Invalid email address";
        description = "Please provide a valid, deliverable email address (e.g. Gmail or your personal email).";
      } else if (lower.includes("already registered") || lower.includes("user already exists")) {
        title = "Account already exists";
        description = "An account with this email already exists. Please sign in with your password.";
      }

      setErrorInfo({
        title,
        description,
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
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">Create account</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Start automating your Instagram comments, leads, and DMs in minutes.
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

      <div className="mt-8 space-y-5">
        {/* OAuth Buttons */}
        <OAuthButtons
          callbackUrl={callbackUrl}
          onError={(msg) =>
            setErrorInfo({
              title: "Sign-up failed",
              description: msg,
            })
          }
        />

        {/* Divider */}
        <div className="flex items-center gap-3 py-1">
          <Separator className="flex-1" />
          <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            or sign up with email
          </span>
          <Separator className="flex-1" />
        </div>

        {/* Form */}
        <form onSubmit={handleSignUp} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="signup-email">Work email</Label>
            <Input
              id="signup-email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-10"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="signup-password">Password</Label>
            <Input
              id="signup-password"
              type="password"
              required
              autoComplete="new-password"
              placeholder="At least 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-10"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="repeat-password">Confirm Password</Label>
            <Input
              id="repeat-password"
              type="password"
              required
              autoComplete="new-password"
              placeholder="Re-enter password"
              value={repeatPassword}
              onChange={(e) => setRepeatPassword(e.target.value)}
              className="h-10"
            />
          </div>

          <Button type="submit" size="lg" className="w-full h-10 font-medium" disabled={isLoading}>
            {isLoading ? "Creating account..." : "Create Account"}
            {!isLoading && <ArrowRight className="ml-2 h-4 w-4" />}
          </Button>
        </form>

        {/* Toggle to Sign In */}
        <div className="pt-2 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href={signInUrl}
            suppressHydrationWarning
            className="font-medium text-foreground underline underline-offset-4 hover:text-primary transition-colors"
          >
            Sign in
          </Link>
        </div>
      </div>

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
