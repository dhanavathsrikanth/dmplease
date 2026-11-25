import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { AuthSidePanel } from "@/components/auth/auth-side-panel";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Authentication Error - dmplease",
  description: "An error occurred during authentication.",
};

async function ErrorContent({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const errorMsg = params?.error
    ? decodeURIComponent(params.error)
    : "An unspecified authentication error occurred.";

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
          Sign-in error
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          We encountered an issue while verifying your credentials.
        </p>
      </div>

      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm leading-6">
        <div className="flex items-start gap-2.5">
          <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-destructive">Authentication Problem</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{errorMsg}</p>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <Button asChild className="w-full">
          <Link href="/auth/login" className="flex items-center justify-center gap-2">
            <ArrowLeft className="h-4 w-4" />
            Try signing in again
          </Link>
        </Button>
      </div>
    </div>
  );
}

export default function ErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <main className="flex-1 flex items-center justify-center px-6 py-12 lg:px-12">
        <Suspense fallback={<div className="w-full max-w-sm animate-pulse h-80" />}>
          <ErrorContent searchParams={searchParams} />
        </Suspense>
      </main>
      <AuthSidePanel />
    </div>
  );
}
