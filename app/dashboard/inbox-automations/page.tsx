import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import {
  Bot,
  Plus,
  Instagram,
  Sparkles,
  ArrowRight,
  MessageSquare,
  ShieldCheck,
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
      <Skeleton className="h-32 rounded-xl" />
      <Skeleton className="h-32 rounded-xl" />
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
    <div className="space-y-6 animate-in fade-in duration-300 antialiased selection:bg-[#ffd02f] selection:text-[#1c1c1e]">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-[#e0e2e8] dark:border-border/80">
        <div>
          <h1 className="text-2xl sm:text-3xl font-medium tracking-tight text-foreground flex items-center gap-2">
            Inbox & Story Automations
          </h1>
          <p className="text-[#555a6a] dark:text-muted-foreground text-xs sm:text-sm mt-0.5">
            Auto-replies triggered directly in your Instagram DM inbox and Story mentions.
          </p>
        </div>

        <Button asChild size="sm" className="rounded-full h-9 text-xs font-semibold gap-1.5 bg-[#1c1c1e] hover:bg-[#2c2c34] text-white shadow-xs shrink-0 px-5 dark:bg-[#ffd02f] dark:text-[#1c1c1e] dark:hover:bg-[#fcb900]">
          <Link href="/dashboard/campaigns/new">
            <Plus className="size-3.5" />
            New Campaign
          </Link>
        </Button>
      </div>

      {!isConnected && (
        <div className="rounded-3xl border border-[#ffd02f]/40 bg-[#fff8e0]/60 dark:bg-[#746019]/20 text-foreground p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-subtle">
          <div className="flex items-center gap-3 text-xs text-foreground">
            <Instagram className="size-4 text-rose-500 shrink-0" />
            <span>
              Connect your Instagram account to activate Story Mention triggers and incoming DM listeners.
            </span>
          </div>
          <Button asChild size="sm" className="rounded-full text-xs font-semibold h-9 px-5 shrink-0 bg-[#1c1c1e] hover:bg-[#2c2c34] text-white dark:bg-white dark:text-[#1c1c1e]">
            <Link href="/dashboard/settings">
              Connect Account <ArrowRight className="size-3 ml-1" />
            </Link>
          </Button>
        </div>
      )}

      <div className="grid gap-4">
        {/* Story Mention Auto-Reply */}
        <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-2.5 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-foreground">
                  Story Mention Auto-Thank You
                </span>
                <Badge
                  variant={isConnected ? "tag-teal" : "outline"}
                  className="text-[10px] font-semibold py-0.5 px-2.5 rounded-full"
                >
                  {isConnected ? "Active on Webhook" : "Not Linked"}
                </Badge>
              </div>
              <p className="text-xs text-[#555a6a] dark:text-muted-foreground">
                Automatically DMs any follower who mentions your account in their Instagram Story.
              </p>
              <div className="p-3 rounded-xl bg-[#f7f8fa] dark:bg-muted/40 border border-[#e0e2e8] dark:border-border/60 text-xs text-foreground font-sans">
                &ldquo;Thanks so much for the story mention! Really appreciate your support 🙌&rdquo;
              </div>
            </div>

            <Button asChild variant="outline" size="sm" className="rounded-full text-xs font-medium h-9 px-5 shrink-0 border-[#c7cad5]">
              <Link href="/dashboard/settings">
                {isConnected ? "Manage Rules" : "Connect Account"}
              </Link>
            </Button>
          </div>
        </Card>

        {/* DM Keyword Trigger: PRICING */}
        <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-2.5 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-foreground">
                  Direct DM Trigger: &ldquo;PRICE&rdquo;
                </span>
                <Badge
                  variant={isConnected ? "tag-teal" : "outline"}
                  className="text-[10px] font-semibold py-0.5 px-2.5 rounded-full"
                >
                  {isConnected ? "Active" : "Not Linked"}
                </Badge>
              </div>
              <p className="text-xs text-[#555a6a] dark:text-muted-foreground">
                Triggered when someone sends &ldquo;PRICE&rdquo; or &ldquo;COST&rdquo; directly to your inbox.
              </p>
              <div className="p-3 rounded-xl bg-[#f7f8fa] dark:bg-muted/40 border border-[#e0e2e8] dark:border-border/60 text-xs text-foreground font-sans">
                &ldquo;Hey! You can view our full package breakdown and pricing tiers here: https://dmplease.com/pricing 🚀&rdquo;
              </div>
            </div>

            <Button asChild variant="outline" size="sm" className="rounded-full text-xs font-medium h-9 px-5 shrink-0 border-[#c7cad5]">
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
