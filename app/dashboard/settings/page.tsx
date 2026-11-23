import { Suspense } from "react";
import { connection } from "next/server";
import {
  Settings as SettingsIcon,
  Instagram,
  Building2,
  User,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { getCurrentProfile, getCurrentUser } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { DisconnectButton } from "@/components/settings/disconnect-button";
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
      <Skeleton className="h-44 rounded-2xl" />
      <Skeleton className="h-44 rounded-2xl" />
    </div>
  );
}

export default function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string; account?: string }>;
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
  searchParams: Promise<{ status?: string; error?: string; account?: string }>;
}) {
  await connection();
  const { status, error } = await searchParams;
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

  // Check actual Instagram connection in database
  let connectedAccount: {
    username: string;
    webhookSubscribed: boolean;
  } | null = null;

  if (workspaceIds.length > 0) {
    const { data: accounts } = await supabase
      .from("instagram_accounts")
      .select("username, webhook_subscribed")
      .in("workspace_id", workspaceIds)
      .limit(1);

    if (accounts && accounts.length > 0) {
      connectedAccount = {
        username: accounts[0].username,
        webhookSubscribed: accounts[0].webhook_subscribed,
      };
    }
  }

  // Account is only connected if an active row exists in instagram_accounts
  const instagramHandle = connectedAccount?.username || null;
  const isConnected = !!instagramHandle;

  return (
    <div className="space-y-6 max-w-4xl animate-in fade-in duration-300">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <SettingsIcon className="size-6 text-primary" />
          Workspace & Instagram Settings
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Manage your connected Instagram creator account, team members, and webhook automations.
        </p>
      </div>

      {status === "connected" && (
        <div className="p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="size-4 shrink-0" />
          <span>Instagram account successfully connected via Meta Graph API!</span>
        </div>
      )}

      {error && (
        <div className="p-3.5 rounded-xl border border-destructive/30 bg-destructive/10 text-destructive text-xs flex items-center gap-2">
          <AlertCircle className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-6">
        {/* ── Instagram Connection Card ── */}
        <Card className="rounded-2xl border-border/80 shadow-xs">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="size-8 rounded-lg bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 flex items-center justify-center text-white">
                  <Instagram className="size-4" />
                </div>
                <div>
                  <CardTitle className="text-base">Instagram Professional Account</CardTitle>
                  <CardDescription className="text-xs">
                    Connected via Meta Graph API & Webhooks
                  </CardDescription>
                </div>
              </div>
              {isConnected ? (
                <Badge
                  variant="outline"
                  className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 font-semibold gap-1"
                >
                  <CheckCircle2 className="size-3" /> Connected
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  Not Linked
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {isConnected ? (
              <div className="p-4 rounded-xl border border-border/70 bg-muted/30 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-foreground">@{instagramHandle}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Webhook subscribed: Comments & Direct Messages
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button asChild size="sm" variant="outline" className="rounded-xl text-xs h-8">
                    <a href="/api/auth/meta/connect">Reconnect</a>
                  </Button>
                  <DisconnectButton />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Connect your Instagram business or creator account to allow dmplease to automatically respond to follower comments with direct messages.
                </p>
                <Button asChild size="sm" className="rounded-xl text-xs h-9 font-semibold bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 gap-2">
                  <a href="/api/auth/meta/connect">
                    <Instagram className="size-4" /> Connect with Facebook / Meta
                  </a>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Workspace Settings Card ── */}
        <Card className="rounded-2xl border-border/80 shadow-xs">
          <CardHeader>
            <div className="flex items-center gap-2.5">
              <Building2 className="size-5 text-primary" />
              <div>
                <CardTitle className="text-base">Workspace Information</CardTitle>
                <CardDescription className="text-xs">
                  Your team and campaign configuration container
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Workspace Name</Label>
              <Input
                readOnly
                value={workspace.name}
                className="rounded-xl max-w-md text-xs h-9 bg-muted/40 font-medium"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Workspace ID</Label>
              <Input
                readOnly
                value={workspace.id}
                className="rounded-xl max-w-md text-xs h-9 bg-muted/40 font-mono text-muted-foreground"
              />
            </div>
          </CardContent>
        </Card>

        {/* ── User Profile Card ── */}
        <Card className="rounded-2xl border-border/80 shadow-xs">
          <CardHeader>
            <div className="flex items-center gap-2.5">
              <User className="size-5 text-primary" />
              <div>
                <CardTitle className="text-base">Account Profile</CardTitle>
                <CardDescription className="text-xs">
                  Your personal authenticated identity
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div className="flex justify-between py-1 border-b border-border/60">
              <span className="text-muted-foreground">Name:</span>
              <span className="font-semibold text-foreground">{profile?.fullName || "Creator"}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-border/60">
              <span className="text-muted-foreground">Email:</span>
              <span className="font-semibold text-foreground">{user?.email}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-border/60">
              <span className="text-muted-foreground">Platform Role:</span>
              <span className="font-semibold text-foreground">Workspace Owner</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">Onboarding Status:</span>
              <Badge variant="outline" className="bg-lime-500/10 text-lime-700 dark:text-lime-300 border-lime-500/30 text-[10px]">
                Completed
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
