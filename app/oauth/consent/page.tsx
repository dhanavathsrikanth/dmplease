"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Lock,
  ArrowRight,
  User,
  ExternalLink,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const SCOPE_DESCRIPTIONS: Record<string, { title: string; desc: string }> = {
  openid: {
    title: "Verify your identity",
    desc: "Confirm your account identity and unique user identifier",
  },
  email: {
    title: "View your email address",
    desc: "Read your primary email address associated with your dmplease account",
  },
  profile: {
    title: "View your profile information",
    desc: "Access your display name, profile avatar, and account details",
  },
  offline_access: {
    title: "Maintain access when offline",
    desc: "Allow the application to refresh access tokens without asking you to sign in again",
  },
};

export default function OAuthConsentPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-muted/30">
      <Suspense fallback={<ConsentSkeleton />}>
        <OAuthConsentContent />
      </Suspense>
    </div>
  );
}

function ConsentSkeleton() {
  return (
    <Card className="w-full max-w-md rounded-2xl border-border/80 shadow-lg p-6 space-y-6 animate-pulse">
      <div className="flex items-center justify-center gap-3">
        <div className="size-12 rounded-xl bg-muted" />
        <div className="size-6 rounded-full bg-muted" />
        <div className="size-12 rounded-xl bg-muted" />
      </div>
      <div className="space-y-2 text-center">
        <div className="h-5 w-48 mx-auto bg-muted rounded-md" />
        <div className="h-4 w-64 mx-auto bg-muted rounded-md" />
      </div>
      <div className="space-y-3 pt-4 border-t">
        <div className="h-12 w-full bg-muted rounded-xl" />
        <div className="h-12 w-full bg-muted rounded-xl" />
      </div>
    </Card>
  );
}

function OAuthConsentContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const authorizationId = searchParams.get("authorization_id");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [clientDetails, setClientDetails] = useState<{
    id: string;
    name: string;
    uri?: string;
    logo_uri?: string;
  } | null>(null);
  const [scopes, setScopes] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState<"approve" | "deny" | null>(null);

  useEffect(() => {
    async function init() {
      if (!authorizationId) {
        setError(
          "Missing authorization_id in request. Please launch the authorization flow from the third-party application."
        );
        setLoading(false);
        return;
      }

      const supabase = createClient();

      // 1. Check if user is signed in
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        // Redirect to login while preserving full consent return URL
        const currentPath = `/oauth/consent?authorization_id=${encodeURIComponent(
          authorizationId
        )}`;
        router.push(`/auth/login?next=${encodeURIComponent(currentPath)}`);
        return;
      }

      setCurrentUserEmail(user.email || null);

      // 2. Fetch authorization details from Supabase OAuth Server
      try {
        const { data, error: authDetailsError } =
          await supabase.auth.oauth.getAuthorizationDetails(authorizationId);

        if (authDetailsError) {
          setError(authDetailsError.message);
        } else if (data) {
          if ("redirect_url" in data) {
            // User has already approved this application; redirect immediately
            window.location.href = data.redirect_url;
            return;
          }

          if ("authorization_id" in data) {
            setClientDetails(data.client);
            if (data.user?.email) {
              setCurrentUserEmail(data.user.email);
            }
            const rawScope = data.scope || "openid email profile";
            setScopes(rawScope.split(" ").filter(Boolean));
          }
        }
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to load authorization details.";
        setError(message);
      } finally {
        setLoading(false);
      }
    }

    init();
  }, [authorizationId, router]);

  const handleApprove = async () => {
    if (!authorizationId) return;
    setSubmitting("approve");
    setError(null);

    const supabase = createClient();
    try {
      const { data, error: approveError } =
        await supabase.auth.oauth.approveAuthorization(authorizationId);

      if (approveError) {
        setError(approveError.message);
        setSubmitting(null);
      } else if (data?.redirect_url) {
        window.location.href = data.redirect_url;
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to approve authorization.";
      setError(message);
      setSubmitting(null);
    }
  };

  const handleDeny = async () => {
    if (!authorizationId) return;
    setSubmitting("deny");
    setError(null);

    const supabase = createClient();
    try {
      const { data, error: denyError } =
        await supabase.auth.oauth.denyAuthorization(authorizationId);

      if (denyError) {
        setError(denyError.message);
        setSubmitting(null);
      } else if (data?.redirect_url) {
        window.location.href = data.redirect_url;
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to cancel authorization.";
      setError(message);
      setSubmitting(null);
    }
  };

  if (loading) {
    return <ConsentSkeleton />;
  }

  if (error && !clientDetails) {
    return (
      <Card className="w-full max-w-md rounded-2xl border-destructive/30 shadow-lg p-6 space-y-4">
        <div className="size-12 rounded-2xl bg-destructive/10 text-destructive flex items-center justify-center mx-auto">
          <AlertCircle className="size-6" />
        </div>
        <div className="text-center space-y-1.5">
          <h2 className="text-lg font-bold text-foreground">
            Authorization Error
          </h2>
          <p className="text-xs text-muted-foreground">{error}</p>
        </div>
        <Button asChild className="w-full rounded-xl text-xs font-semibold mt-4">
          <Link href="/dashboard">Return to Dashboard</Link>
        </Button>
      </Card>
    );
  }

  const appName = clientDetails?.name || "Third-Party Application";
  const clientUri = clientDetails?.uri;

  return (
    <Card className="w-full max-w-md rounded-2xl border-border/80 bg-card shadow-xl overflow-hidden animate-in fade-in-50 duration-200">
      <CardHeader className="text-center pb-2 pt-6">
        {/* Brand connection logos */}
        <div className="flex items-center justify-center gap-3 mb-3">
          <div className="size-12 rounded-xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 flex items-center justify-center font-bold text-base shadow-sm">
            dm
          </div>
          <ArrowRight className="size-4 text-muted-foreground" />
          <Avatar
            src={clientDetails?.logo_uri || undefined}
            alt={appName}
            className="size-12 rounded-xl border border-border/80 shadow-sm"
          >
            <AvatarFallback className="rounded-xl font-bold text-sm bg-muted text-foreground">
              {appName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </div>

        <h1 className="text-xl font-bold tracking-tight text-foreground">
          Authorize {appName}
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          {appName} wants to access your{" "}
          <span className="font-semibold text-foreground">dmplease</span>{" "}
          account.
        </p>

        {clientUri && (
          <a
            href={clientUri}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground mt-1 underline underline-offset-2"
          >
            <span>{clientUri}</span>
            <ExternalLink className="size-3" />
          </a>
        )}
      </CardHeader>

      <CardContent className="space-y-4 pt-2">
        {/* Active Account Pill */}
        <div className="p-3 rounded-xl bg-muted/40 border border-border/60 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <User className="size-4 text-muted-foreground" />
            <span className="font-medium text-foreground truncate max-w-[220px]">
              {currentUserEmail}
            </span>
          </div>
          <Badge variant="outline" className="text-[10px] bg-background">
            Signed In
          </Badge>
        </div>

        {/* Requested Permissions */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <ShieldCheck className="size-4 text-primary" />
            Requested Permissions:
          </p>

          <div className="divide-y divide-border/60 rounded-xl border border-border/80 bg-background/50 overflow-hidden text-xs">
            {scopes.map((scope) => {
              const info = SCOPE_DESCRIPTIONS[scope] || {
                title: `Permission: ${scope}`,
                desc: `Grant access to the ${scope} scope`,
              };

              return (
                <div key={scope} className="p-3 flex items-start gap-2.5">
                  <CheckCircle2 className="size-4 text-emerald-500 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <p className="font-semibold text-foreground">{info.title}</p>
                    <p className="text-[11px] text-muted-foreground leading-tight">
                      {info.desc}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-xs flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="p-3 rounded-xl bg-muted/20 border border-border/40 text-[11px] text-muted-foreground leading-relaxed flex items-start gap-2">
          <Lock className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <span>
            By authorizing, you allow {appName} to access your account data in accordance with their privacy policy and terms. You can revoke access at any time in Settings.
          </span>
        </div>
      </CardContent>

      <CardFooter className="flex flex-col sm:flex-row gap-2 pt-0 pb-6 px-6">
        <Button
          variant="outline"
          onClick={handleDeny}
          disabled={submitting !== null}
          className="w-full sm:w-1/2 rounded-xl text-xs h-10 font-semibold"
        >
          {submitting === "deny" ? (
            <Loader2 className="size-3.5 animate-spin mr-1.5" />
          ) : null}
          Cancel
        </Button>

        <Button
          onClick={handleApprove}
          disabled={submitting !== null}
          className="w-full sm:w-1/2 rounded-xl text-xs h-10 font-semibold bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-sm"
        >
          {submitting === "approve" ? (
            <Loader2 className="size-3.5 animate-spin mr-1.5" />
          ) : null}
          Allow Access
        </Button>
      </CardFooter>
    </Card>
  );
}
