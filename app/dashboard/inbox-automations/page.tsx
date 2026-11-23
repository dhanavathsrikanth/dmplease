import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import {
  Bot,
  Plus,
  Instagram,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Inbox Automations - dmplease",
};

function InboxAutomationsSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <Skeleton className="h-8 w-64 rounded-xl" />
      <Skeleton className="h-32 rounded-2xl" />
      <Skeleton className="h-32 rounded-2xl" />
    </div>
  );
}

export default function InboxAutomationsPage() {
  return (
    <Suspense fallback={<InboxAutomationsSkeleton />}>
      <InboxAutomationsContent />
    </Suspense>
  );
}

async function InboxAutomationsContent() {
  await connection();
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  const workspaceIds = (profile?.ownedWorkspaces || []).map((w) => w.id);

  let isConnected = false;
  let instagramUsername: string | null = null;

  if (workspaceIds.length > 0) {
    const { data: accounts } = await supabase
      .from("instagram_accounts")
      .select("username, webhook_subscribed")
      .in("workspace_id", workspaceIds)
      .limit(1);

    if (accounts && accounts.length > 0) {
      isConnected = true;
      instagramUsername = accounts[0].username;
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Bot className="size-6 text-primary" />
            Inbox & Story Automations
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Auto-replies triggered directly in your Instagram DM inbox and Story mentions.
          </p>
        </div>

        <Button asChild size="sm" className="rounded-xl h-9 text-xs font-semibold gap-1.5 bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-sm shrink-0">
          <Link href="/dashboard/campaigns/new">
            <Plus className="size-3.5" />
            New Campaign
          </Link>
        </Button>
      </div>

      {!isConnected && (
        <Card className="rounded-2xl border-border/80 bg-neutral-50 dark:bg-neutral-900/40 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs">
            <Instagram className="size-4 text-rose-500 shrink-0" />
            <span className="text-muted-foreground">
              Connect your Instagram account to activate Story Mention triggers and incoming DM listeners.
            </span>
          </div>
          <Button asChild size="sm" variant="outline" className="rounded-xl text-xs h-8 shrink-0">
            <Link href="/dashboard/settings">
              Connect Account <ArrowRight className="size-3 ml-1" />
            </Link>
          </Button>
        </Card>
      )}

      <div className="grid gap-4">
        {/* Story Mention Auto-Reply */}
        <Card className="rounded-2xl border-border/80 shadow-xs p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1.5 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-foreground">
                  Story Mention Auto-Thank You
                </span>
                <Badge
                  variant="outline"
                  className={
                    isConnected
                      ? "bg-lime-500/10 text-lime-700 dark:text-lime-300 border-lime-500/30 text-[10px]"
                      : "bg-muted text-muted-foreground border-border text-[10px]"
                  }
                >
                  {isConnected ? "Active on Webhook" : "Not Linked"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Automatically DMs any follower who mentions your account in their Instagram Story.
              </p>
              <div className="p-2.5 rounded-xl bg-muted/40 border border-border/60 text-xs italic">
                &ldquo;Thanks so much for the story mention! Really appreciate your support 🙌&rdquo;
              </div>
            </div>

            <Button asChild variant="outline" size="sm" className="rounded-xl text-xs h-8 shrink-0">
              <Link href="/dashboard/settings">
                {isConnected ? "Manage Rules" : "Connect Account"}
              </Link>
            </Button>
          </div>
        </Card>

        {/* DM Keyword Trigger: PRICING */}
        <Card className="rounded-2xl border-border/80 shadow-xs p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1.5 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-foreground">
                  Direct DM Trigger: &ldquo;PRICE&rdquo;
                </span>
                <Badge
                  variant="outline"
                  className={
                    isConnected
                      ? "bg-lime-500/10 text-lime-700 dark:text-lime-300 border-lime-500/30 text-[10px]"
                      : "bg-muted text-muted-foreground border-border text-[10px]"
                  }
                >
                  {isConnected ? "Active" : "Not Linked"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Triggered when someone sends &ldquo;PRICE&rdquo; or &ldquo;COST&rdquo; directly to your inbox.
              </p>
              <div className="p-2.5 rounded-xl bg-muted/40 border border-border/60 text-xs italic">
                &ldquo;Hey! You can view our full package breakdown and pricing tiers here: https://dmplease.com/pricing 🚀&rdquo;
              </div>
            </div>

            <Button asChild variant="outline" size="sm" className="rounded-xl text-xs h-8 shrink-0">
              <Link href="/dashboard/campaigns/new">
                Configure Rule
              </Link>
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
