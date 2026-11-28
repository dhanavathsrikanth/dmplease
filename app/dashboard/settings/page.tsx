/* eslint-disable @next/next/no-img-element */
import { Suspense } from "react";
import { connection } from "next/server";
import {
  Instagram,
  Building2,
  User,
  CheckCircle2,
  AlertCircle,
  BadgeCheck,
  KeyRound,
} from "lucide-react";
import { getCurrentProfile, getCurrentUser } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { DisconnectButton } from "@/components/settings/disconnect-button";
import { VerifiedBadgeToggle } from "@/components/settings/verified-badge-toggle";
import { ConversionToken } from "@/components/settings/conversion-token";
import { ReportLinkSettings } from "@/components/settings/report-link-settings";
import { WorkspacePreferencesSettings } from "@/components/settings/workspace-preferences-settings";
import { getWorkspacePreferences } from "@/lib/workspace-preferences";
import { AccountSelection } from "@/components/onboarding/account-selection";
import { getReportLink } from "@/app/dashboard/settings/report-actions";
import { createWorkspaceToken } from "@/lib/conversions";
import { normalizeFallbackReply } from "@/lib/dm-rules";
import { FallbackReplySettings } from "@/components/settings/fallback-reply-settings";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import type { FallbackAccountOption } from "@/components/settings/fallback-reply-settings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata = {
  title: "Settings - dmplease",
};

function SettingsSkeleton() {
  return (
    <div className="space-y-6 max-w-4xl animate-pulse">
      <Skeleton className="h-8 w-64 rounded-xl" />
      <Skeleton className="h-44 rounded-xl" />
      <Skeleton className="h-44 rounded-xl" />
    </div>
  );
}

export default function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    error?: string;
    account?: string;
    pending?: string;
  }>;
}) {
  return (
    <Suspense fallback={<SettingsSkeleton />}>
      <SettingsContent searchParams={searchParams} />
    </Suspense>
  );
}

async function SettingsContent({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    error?: string;
    account?: string;
    pending?: string;
  }>;
}) {
  await connection();
  const { status, error, pending } = await searchParams;
  const user = await getCurrentUser();
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  const workspace = profile?.ownedWorkspaces?.[0] || {
    id: user?.id,
    name: "Personal Workspace",
  };

  const workspaceIds = (profile?.ownedWorkspaces || []).map((w) => w.id);
  if (workspace.id && !workspaceIds.includes(workspace.id)) {
    workspaceIds.push(workspace.id);
  }

  const reportLink = workspace.id
    ? await getReportLink(String(workspace.id))
    : null;

  // The conversion token embeds the workspace's current token version so a
  // rotation in Settings invalidates every previously issued token.
  let conversionTokenVersion = 1;
  if (workspace.id) {
    const { data: tokenWorkspace } = await supabase
      .from("workspaces")
      .select("conversion_token_version")
      .eq("id", workspace.id)
      .maybeSingle();
    conversionTokenVersion = Number(
      tokenWorkspace?.conversion_token_version ?? 1
    );
  }
  const preferences = workspace.id
    ? await getWorkspacePreferences(String(workspace.id))
    : { timezone: "Asia/Kolkata", weekStartsOn: 1 };

  // Check actual Instagram connection in database
  let connectedAccount: {
    username: string;
    webhookSubscribed: boolean;
    tokenStatus: string | null;
    tokenLastError: string | null;
    profilePictureUrl: string | null;
    isVerified: boolean;
    isVerifiedManual: boolean;
  } | null = null;

  if (workspaceIds.length > 0) {
    const { data: accounts } = await supabase
      .from("instagram_accounts")
      .select(
        "username, webhook_subscribed, token_status, token_last_error, profile_picture_url, is_verified, is_verified_manual"
      )
      .in("workspace_id", workspaceIds)
      .limit(1);

    if (accounts && accounts.length > 0) {
      connectedAccount = {
        username: accounts[0].username,
        webhookSubscribed: accounts[0].webhook_subscribed,
        tokenStatus: accounts[0].token_status,
        tokenLastError: accounts[0].token_last_error,
        profilePictureUrl: accounts[0].profile_picture_url,
        isVerified: Boolean(accounts[0].is_verified_manual || accounts[0].is_verified),
        isVerifiedManual: Boolean(accounts[0].is_verified_manual),
      };
    }
  }

  let fallbackAccounts: FallbackAccountOption[] = [];
  if (workspaceIds.length > 0) {
    const { data: accounts } = await supabase
      .from("instagram_accounts")
      .select(
        "id, workspace_id, username, fallback_reply_enabled, fallback_reply_message, fallback_reply_variants, fallback_once_per_days, fallback_follow_gate_enabled, fallback_opening_message, fallback_follow_gate_button_label, fallback_follow_gate_on_unavailable, fallback_button_text, fallback_button_url"
      )
      .in("workspace_id", workspaceIds)
      .order("username");
    fallbackAccounts = (accounts ?? []).map((account) => ({
      id: String(account.id),
      username: String(account.username || "instagram_account"),
      workspaceId: String(account.workspace_id),
      fallback: normalizeFallbackReply(account),
    }));
  }

  const instagramHandle = connectedAccount?.username || null;
  const isConnected = !!instagramHandle;

  return (
    <div className="space-y-6 max-w-4xl animate-in fade-in duration-300 antialiased selection:bg-[#ffd02f] selection:text-[#1c1c1e]">
      <div className="pb-3 border-b border-[#e0e2e8] dark:border-border/80">
        <h1 className="text-2xl sm:text-3xl font-medium tracking-tight text-foreground flex items-center gap-2">
          Workspace Settings
        </h1>
        <p className="text-[#555a6a] dark:text-muted-foreground text-xs sm:text-sm mt-0.5">
          Manage your connected Instagram creator account, team members, and webhook permissions.
        </p>
      </div>

      {pending && (
        <AccountSelection
          pendingId={pending}
          redirectTo="/dashboard/settings"
        />
      )}

      {status === "connected" && (
        <div className="p-4 rounded-2xl border border-[#0fbcb0]/30 bg-[#c3faf5]/40 text-foreground text-xs font-medium flex items-center gap-2">
          <CheckCircle2 className="size-4 text-[#00b473] shrink-0" />
          <span>Instagram account successfully connected via Meta Graph API!</span>
        </div>
      )}

      {connectedAccount &&
        connectedAccount.tokenStatus !== "active" &&
        connectedAccount.tokenStatus !== null && (
          <div className="p-4 rounded-2xl border border-amber-500/40 bg-amber-50 dark:bg-amber-950/20 text-foreground text-xs space-y-1">
            <p className="font-semibold">
              Reconnect required — automated DMs are paused
            </p>
            <p className="text-muted-foreground">
              {connectedAccount.tokenLastError ||
                "Meta rejected the stored access token. Reconnect with a Facebook account that manages this Instagram account so a Page access token is stored."}
            </p>
          </div>
        )}

      {error && (
        <div className="p-4 rounded-2xl border border-destructive/30 bg-destructive/10 text-destructive text-xs font-medium flex items-center gap-2">
          <AlertCircle className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-5">
        {/* ── Instagram Connection Card ── */}
        <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle bg-card">
          <CardHeader className="pb-3 border-b border-[#e0e2e8] dark:border-border/60">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="size-8 rounded-xl bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 flex items-center justify-center text-white shadow-xs">
                  <Instagram className="size-4" />
                </div>
                <div>
                  <CardTitle className="text-sm font-semibold">Instagram Professional Account</CardTitle>
                  <CardDescription className="text-xs text-[#555a6a] dark:text-muted-foreground">
                    Connected via Meta Graph API & Webhooks
                  </CardDescription>
                </div>
              </div>
              {isConnected ? (
                <Badge
                  variant="tag-teal"
                  className="text-[10px] font-semibold py-0.5 px-3 rounded-full gap-1"
                >
                  <span className="size-1.5 rounded-full bg-[#00b473]" /> Connected
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] font-medium rounded-full">
                  Not Linked
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-5 space-y-4 text-sm">
            {isConnected ? (
              <>
              <div className="p-4 rounded-xl border border-[#e0e2e8] dark:border-border bg-[#f7f8fa] dark:bg-muted/30 flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  {connectedAccount?.profilePictureUrl ? (
                    <img
                      src={connectedAccount.profilePictureUrl}
                      alt=""
                      className="size-10 rounded-full object-cover shrink-0"
                    />
                  ) : (
                    <div className="size-10 rounded-full bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground text-xs sm:text-sm flex items-center gap-1 truncate">
                      @{instagramHandle}
                      {connectedAccount?.isVerified && (
                        <BadgeCheck className="size-3.5 text-sky-500 fill-sky-500 text-white shrink-0" />
                      )}
                    </p>
                    <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground mt-0.5">
                      Webhook subscribed: Comments & Direct Messages
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button asChild size="sm" variant="outline" className="rounded-full text-xs h-9 px-4 border-[#c7cad5]">
                    <a href="/api/auth/meta/connect">Reconnect</a>
                  </Button>
                  <DisconnectButton />
                </div>
              </div>
              {connectedAccount && (
                <VerifiedBadgeToggle
                  initialChecked={connectedAccount.isVerified}
                  detectedByMeta={Boolean(connectedAccount.isVerified && !connectedAccount.isVerifiedManual)}
                />
              )}
              </>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-[#555a6a] dark:text-muted-foreground leading-relaxed">
                  Connect your Instagram business or creator account to allow dmplease to automatically respond to follower comments with direct messages.
                </p>
                <Button asChild size="sm" className="rounded-full text-xs h-9 font-semibold bg-[#1c1c1e] hover:bg-[#2c2c34] text-white px-5 gap-2 shadow-xs dark:bg-white dark:text-[#1c1c1e]">
                  <a href="/api/auth/meta/connect">
                    <Instagram className="size-3.5 text-rose-500" /> Connect via Facebook / Meta
                  </a>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <FallbackReplySettings accounts={fallbackAccounts} />

        {workspace.id && (
          <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle bg-card">
            <CardHeader className="pb-3 border-b border-[#e0e2e8] dark:border-border/60">
              <CardTitle className="text-sm font-semibold">Revenue attribution</CardTitle>
              <CardDescription className="text-xs text-[#555a6a] dark:text-muted-foreground">
                Tie external purchases and leads back to the Reel and keyword that started them.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-5">
              <ConversionToken
                token={createWorkspaceToken(
                  String(workspace.id),
                  conversionTokenVersion
                )}
              />
            </CardContent>
          </Card>
        )}

        {workspace.id && (
          <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle bg-card">
            <CardHeader className="pb-3 border-b border-[#e0e2e8] dark:border-border/60">
              <CardTitle className="text-sm font-semibold">
                Time zone &amp; calendar
              </CardTitle>
              <CardDescription className="text-xs text-[#555a6a] dark:text-muted-foreground">
                The clock behind every analytics range, heatmap, and timestamp.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-5">
              <WorkspacePreferencesSettings
                workspaceId={String(workspace.id)}
                initialTimezone={preferences.timezone}
                initialWeekStartsOn={preferences.weekStartsOn}
              />
            </CardContent>
          </Card>
        )}

        {workspace.id && (
          <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle bg-card">
            <CardHeader className="pb-3 border-b border-[#e0e2e8] dark:border-border/60">
              <CardTitle className="text-sm font-semibold">Public report link</CardTitle>
              <CardDescription className="text-xs text-[#555a6a] dark:text-muted-foreground">
                Share a read-only performance report with a client or teammate.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-5">
              <ReportLinkSettings
                workspaceId={String(workspace.id)}
                initialLink={reportLink}
              />
            </CardContent>
          </Card>
        )}

        {/* ── Workspace Settings Card ── */}
        <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle bg-card">
          <CardHeader className="pb-3 border-b border-[#e0e2e8] dark:border-border/60">
            <div className="flex items-center gap-2.5">
              <Building2 className="size-4 text-foreground" />
              <div>
                <CardTitle className="text-sm font-semibold">Workspace Information</CardTitle>
                <CardDescription className="text-xs text-[#555a6a] dark:text-muted-foreground">
                  Your team and campaign configuration container
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-5 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground">Workspace Name</Label>
              <Input
                readOnly
                value={workspace.name}
                className="rounded-lg max-w-md text-xs h-9 bg-[#f7f8fa] dark:bg-muted/40 font-medium border-[#c7cad5]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground">Workspace ID</Label>
              <Input
                readOnly
                value={workspace.id}
                className="rounded-lg max-w-md text-xs h-9 bg-[#f7f8fa] dark:bg-muted/40 font-mono text-[#6b6f7e] border-[#c7cad5]"
              />
            </div>
          </CardContent>
        </Card>

        {/* ── User Profile Card ── */}
        <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle bg-card">
          <CardHeader className="pb-3 border-b border-[#e0e2e8] dark:border-border/60">
            <div className="flex items-center gap-2.5">
              <User className="size-4 text-foreground" />
              <div>
                <CardTitle className="text-sm font-semibold">Account Profile</CardTitle>
                <CardDescription className="text-xs text-[#555a6a] dark:text-muted-foreground">
                  Your personal authenticated identity
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-5 space-y-3 text-xs">
            <div className="flex justify-between py-2 border-b border-[#e0e2e8]/60 dark:border-border/60">
              <span className="text-[#6b6f7e]">Name:</span>
              <span className="font-semibold text-foreground">{profile?.fullName || "Creator"}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-[#e0e2e8]/60 dark:border-border/60">
              <span className="text-[#6b6f7e]">Email:</span>
              <span className="font-mono text-foreground">{user?.email}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-[#e0e2e8]/60 dark:border-border/60">
              <span className="text-[#6b6f7e]">Platform Role:</span>
              <span className="font-semibold text-foreground">Workspace Owner</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-[#6b6f7e]">Onboarding Status:</span>
              <Badge variant="tag-teal" className="text-[10px] font-semibold py-0.5 px-2.5 rounded-full">
                Completed
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* ── Password Card ── */}
        <Card
          id="password"
          className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle bg-card"
        >
          <CardHeader className="pb-3 border-b border-[#e0e2e8] dark:border-border/60">
            <div className="flex items-center gap-2.5">
              <KeyRound className="size-4 text-foreground" />
              <div>
                <CardTitle className="text-sm font-semibold">Password</CardTitle>
                <CardDescription className="text-xs text-[#555a6a] dark:text-muted-foreground">
                  Change the password for your signed-in account
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-5">
            <ChangePasswordForm
              hasPasswordIdentity={(user?.identities ?? []).some(
                (identity) => identity.provider === "email"
              )}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
