"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function UpdatePasswordForm() {
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
      const { error } = await supabase.auth.updateUser({
        password,
      });

      if (error) {
        throw error;
      }

      setIsSuccess(true);
      setTimeout(() => {
        router.push("/dashboard");
        router.refresh();
      }, 1500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to update password";
      setErrorInfo({
        title: "Update failed",
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
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">Update password</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Set a new secure password for your account.
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
          <p className="mt-1 text-xs text-muted-foreground">
            Your password was changed successfully. Redirecting you to your account...
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
              placeholder="At least 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-10"
            />
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

          <Button type="submit" size="lg" className="w-full h-10 font-medium" disabled={isLoading}>
            {isLoading ? "Saving..." : "Update Password"}
            {!isLoading && <ArrowRight className="ml-2 h-4 w-4" />}
          </Button>
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
