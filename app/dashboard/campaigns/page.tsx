import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import {
  Megaphone,
  Plus,
  MessageCircle,
  Tag,
  BookOpen,
  Calendar,
} from "lucide-react";
import { getCurrentProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata = {
  title: "Campaigns - dmplease",
};

function CampaignsSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-60 rounded-xl" />
        <Skeleton className="h-9 w-32 rounded-xl" />
      </div>
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

export default function CampaignsPage() {
  return (
    <Suspense fallback={<CampaignsSkeleton />}>
      <CampaignsContent />
    </Suspense>
  );
}

async function CampaignsContent() {
  await connection();
  const profile = await getCurrentProfile();
  const supabase = await createClient();
  const allAutomations = (profile?.ownedWorkspaces || []).flatMap(
    (w) => w.automations || []
  );

  const automationIds = allAutomations.map((a) => a.id);
  const logCountsByAutoId: Record<string, number> = {};

  if (automationIds.length > 0) {
    const { data: logStats } = await supabase
      .from("dm_logs")
      .select("automation_id")
      .in("automation_id", automationIds);

    if (logStats) {
      for (const log of logStats) {
        if (log.automation_id) {
          logCountsByAutoId[log.automation_id] =
            (logCountsByAutoId[log.automation_id] || 0) + 1;
        }
      }
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Comment-to-DM Campaigns
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Configure automated direct messages triggered by comments on your Instagram posts, reels, and live videos.
          </p>
        </div>

        <Button asChild size="sm" className="rounded-xl h-9 text-xs font-semibold gap-1.5 bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-sm shrink-0">
          <Link href="/dashboard/campaigns/new">
            <Plus className="size-3.5" />
            New Campaign
          </Link>
        </Button>
      </div>

      {/* ── Campaigns List ── */}
      {allAutomations.length > 0 ? (
        <div className="grid gap-4">
          {allAutomations.map((auto) => (
            <Card
              key={auto.id}
              className="rounded-2xl border-border/80 shadow-xs hover:border-neutral-400 dark:hover:border-neutral-600 transition-all p-5"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-start gap-4 flex-1">
                  {auto.postThumbnailUrl && (
                    <div className="relative size-16 rounded-xl overflow-hidden border border-border/80 shrink-0 shadow-xs">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={auto.postThumbnailUrl}
                        alt={auto.name}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute bottom-0 inset-x-0 bg-black/70 text-[9px] text-white text-center py-0.5 font-bold uppercase tracking-wider">
                        Reel
                      </div>
                    </div>
                  )}

                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-base text-foreground">
                        {auto.name}
                      </span>
                      <Badge
                        variant="outline"
                        className="bg-lime-500/10 text-lime-700 dark:text-lime-300 border-lime-500/30 text-xs font-semibold"
                      >
                        Active
                      </Badge>
                      {auto.postScope === "SPECIFIC_POST" ? (
                        <Badge variant="outline" className="text-xs bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30 font-medium">
                          Specific Reel Attached
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs font-normal">
                          All Posts &amp; Reels
                        </Badge>
                      )}
                      <Badge variant="secondary" className="text-xs font-normal capitalize">
                        {auto.goal ? auto.goal.replace("_", " ") : "Custom Auto-Reply"}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Trigger keywords:</span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {auto.triggerKeywords.map((kw, i) => (
                          <code
                            key={i}
                            className="px-2 py-0.5 rounded-md bg-muted font-mono font-bold text-xs text-foreground"
                          >
                            {kw}
                          </code>
                        ))}
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-muted/40 border border-border/60 text-xs text-foreground italic flex items-center gap-2">
                      <MessageCircle className="size-4 text-primary shrink-0 not-italic" />
                      <span className="line-clamp-2">&ldquo;{auto.dmMessage}&rdquo;</span>
                    </div>
                  </div>
                </div>

                <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 shrink-0 border-t sm:border-t-0 pt-3 sm:pt-0 border-border/60">
                  <div className="text-left sm:text-right">
                    <p className="text-xs text-muted-foreground">Triggers Fired</p>
                    <p className="text-lg font-bold text-foreground">
                      {logCountsByAutoId[auto.id] || 0} DMs
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[11px] text-emerald-600 border-emerald-500/30 bg-emerald-500/10">
                    Listening to Comments
                  </Badge>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="rounded-2xl border-dashed p-10 text-center space-y-4">
          <div className="size-12 rounded-2xl bg-muted flex items-center justify-center mx-auto text-muted-foreground">
            <Megaphone className="size-6" />
          </div>
          <div>
            <h3 className="font-semibold text-base text-foreground">No campaigns configured yet</h3>
            <p className="text-xs text-muted-foreground max-w-md mx-auto mt-1">
              Start with a preset template like Lead Magnet delivery, Discount links, or Discovery Call booking.
            </p>
          </div>
          <Button asChild size="sm" className="rounded-xl font-semibold text-xs mt-2">
            <Link href="/dashboard/campaigns/new">Create Your First Campaign</Link>
          </Button>
        </Card>
      )}

      {/* ── Preset Inspirations ── */}
      <div className="mt-8 space-y-3">
        <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider text-muted-foreground/80">
          Recommended Campaign Recipes
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-4 rounded-xl border border-border/80 bg-card hover:bg-muted/30 transition-colors space-y-1.5">
            <div className="flex items-center gap-2">
              <BookOpen className="size-4 text-emerald-600" />
              <h4 className="font-semibold text-xs text-foreground">Freebie / Cheat Sheet</h4>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Followers comment &ldquo;GUIDE&rdquo; $\rightarrow$ instant DM with Notion or PDF link.
            </p>
          </div>
          <div className="p-4 rounded-xl border border-border/80 bg-card hover:bg-muted/30 transition-colors space-y-1.5">
            <div className="flex items-center gap-2">
              <Tag className="size-4 text-amber-600" />
              <h4 className="font-semibold text-xs text-foreground">VIP Discount Promo</h4>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Followers comment &ldquo;VIP&rdquo; $\rightarrow$ auto DM with unique 20% discount code.
            </p>
          </div>
          <div className="p-4 rounded-xl border border-border/80 bg-card hover:bg-muted/30 transition-colors space-y-1.5">
            <div className="flex items-center gap-2">
              <Calendar className="size-4 text-sky-600" />
              <h4 className="font-semibold text-xs text-foreground">Discovery Call Link</h4>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Followers comment &ldquo;CALL&rdquo; $\rightarrow$ direct Calendly calendar invite link.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
