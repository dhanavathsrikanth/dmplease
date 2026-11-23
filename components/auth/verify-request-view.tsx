"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Mail, ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function VerifyRequestView() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email");

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

      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Check your email
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {email ? (
            <>
              We sent a verification link to{" "}
              <span className="font-medium text-foreground">{email}</span>. Click the link to complete your sign-in.
            </>
          ) : (
            "We've sent a secure confirmation link to your inbox. Open it on this device to continue."
          )}
        </p>
      </div>

      <Card className="border-border/80 shadow-sm">
        <CardContent className="pt-6 text-center space-y-4">
          <div className="flex items-center justify-center">
            <div className="h-14 w-14 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <Mail className="h-7 w-7" />
            </div>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">
            Didn&apos;t receive it? Check your spam folder or junk mail, or request another link.
          </p>

          <div className="pt-2">
            <Button asChild variant="outline" className="w-full">
              <Link href="/auth/login" className="flex items-center justify-center gap-2">
                <ArrowLeft className="h-4 w-4" />
                Return to sign in
              </Link>
            </Button>
          </div>

          <p className="text-[11px] text-muted-foreground/80">
            For security, the link will expire shortly.
          </p>
        </CardContent>
      </Card>

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
