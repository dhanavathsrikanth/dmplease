import Image from "next/image";
import Link from "next/link";
import { AlertCircle, ArrowLeft, KeyRound, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";

interface RecoveryLinkInvalidProps {
  /** True when the visitor already has a normal (non-recovery) session. */
  signedIn: boolean;
}

/**
 * Shown when someone opens /auth/update-password without a valid recovery
 * grant. This is the UX half of the gate: a normal session is told to use the
 * Settings password card, and an anonymous visitor is sent back to request a
 * fresh link. The server action enforces the same rule independently.
 */
export function RecoveryLinkInvalid({ signedIn }: RecoveryLinkInvalidProps) {
  return (
    <div className="w-full max-w-sm">
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

      <div className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          {signedIn ? "Use your account settings" : "Reset link expired"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {signedIn
            ? "This page only works from a password reset email. You are already signed in, so change your password from Settings instead."
            : "This password reset link is invalid or has expired. Request a new one and we'll email you a fresh link."}
        </p>
      </div>

      <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-4 text-sm leading-6">
        <div className="flex items-start gap-2.5">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="font-semibold text-amber-700 dark:text-amber-300">
              {signedIn ? "Recovery link required" : "Link no longer valid"}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {signedIn
                ? "Changing a password from Settings requires your current password. If you have forgotten it, request a reset link below."
                : "Reset links can only be used once and expire after a short time. For your security, they cannot be reused."}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 space-y-2.5">
        {signedIn ? (
          <Button asChild className="w-full">
            <Link href="/dashboard/settings#password" className="flex items-center justify-center gap-2">
              <KeyRound className="h-4 w-4" />
              Go to password settings
            </Link>
          </Button>
        ) : (
          <Button asChild className="w-full">
            <Link
              href="/auth/forgot-password"
              className="flex items-center justify-center gap-2"
            >
              <Mail className="h-4 w-4" />
              Request a new link
            </Link>
          </Button>
        )}

        <Button asChild variant="outline" className="w-full">
          <Link href="/auth/login" className="flex items-center justify-center gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to sign in
          </Link>
        </Button>
      </div>

      {signedIn && (
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Forgot your current password?{" "}
          <Link
            href="/auth/forgot-password"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Request a reset link
          </Link>
          .
        </p>
      )}

      <p className="mt-8 text-center text-xs text-muted-foreground">
        Need help?{" "}
        <Link href="/support" className="underline underline-offset-2 hover:text-foreground">
          Contact support
        </Link>
        .
      </p>
    </div>
  );
}
