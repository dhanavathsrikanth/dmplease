import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import {
  Plus,
  BookOpen,
  Tag,
  Calendar,
  CheckCircle2,
} from "lucide-react";
import { getCurrentProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CampaignsList } from "@/components/campaigns/campaigns-list";

export const metadata = {
  title: "Campaigns - dmplease",
};

function CampaignsSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between pb-2 border-b">
        <Skeleton className="h-8 w-60 rounded-xl" />
        <Skeleton className="h-8 w-32 rounded-lg" />
      </div>
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export default function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; saved?: string }>;
}) {
  return (
    <Suspense fallback={<CampaignsSkeleton />}>
      <CampaignsContent searchParams={searchParams} />
    </Suspense>
  );
}

async function CampaignsContent({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; saved?: string }>;
}) {
  const { created, saved } = await searchParams;
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
    <div className="space-y-6 animate-in fade-in duration-300 antialiased selection:bg-[#ffd02f] selection:text-[#1c1c1e]">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-[#e0e2e8] dark:border-border/80">
        <div>
          <h1 className="text-2xl sm:text-3xl font-medium tracking-tight text-foreground font-rubik">
            Comment-to-DM Campaigns
          </h1>
          <p className="text-[#555a6a] dark:text-muted-foreground text-xs sm:text-sm mt-0.5">
            Configure automated direct messages triggered by comments on your Instagram posts, reels, and carousels.
          </p>
        </div>

        <Button asChild size="sm" className="rounded-full h-9 text-xs font-semibold gap-1.5 bg-[#1c1c1e] hover:bg-[#2c2c34] text-white shadow-xs shrink-0 px-5 dark:bg-[#ffd02f] dark:text-[#1c1c1e] dark:hover:bg-[#fcb900]">
          <Link href="/dashboard/campaigns/new">
            <Plus className="size-3.5" />
            New Campaign
          </Link>
        </Button>
      </div>

      {created === "1" && (
        <div
          role="status"
          className="flex items-center gap-2.5 rounded-2xl border border-emerald-300/50 bg-emerald-50/60 dark:bg-emerald-950/20 px-4 py-3 text-xs font-semibold text-emerald-800 dark:text-emerald-300"
        >
          <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
          Campaign published. Comment your keyword from another account to test it.
        </div>
      )}

      {saved === "1" && (
        <div
          role="status"
          className="flex items-center gap-2.5 rounded-2xl border border-emerald-300/50 bg-emerald-50/60 dark:bg-emerald-950/20 px-4 py-3 text-xs font-semibold text-emerald-800 dark:text-emerald-300"
        >
          <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
          Campaign changes saved.
        </div>
      )}

      {/* ── Interactive Campaigns List (Switch active/pause, delete dialog, tabs) ── */}
      <CampaignsList
        initialAutomations={allAutomations}
        logCountsByAutoId={logCountsByAutoId}
      />

      {/* ── Preset Inspirations (Miro Pastel 3-grid) ── */}
      <div className="mt-8 space-y-3">
        <h3 className="text-xs font-bold text-[#6b6f7e] uppercase tracking-wider">
          Recommended Campaign Recipes
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-4 rounded-2xl border border-[#ffd02f]/40 bg-[#fff8e0]/50 dark:bg-[#746019]/20 transition-all shadow-subtle space-y-2">
            <div className="flex items-center gap-2">
              <BookOpen className="size-4 text-[#746019] dark:text-[#ffd02f]" />
              <h4 className="font-semibold text-xs text-foreground font-rubik">Freebie / Cheat Sheet</h4>
            </div>
            <p className="text-[#555a6a] dark:text-muted-foreground leading-relaxed text-[11px]">
              Followers comment &ldquo;GUIDE&rdquo; &rarr; instant DM with Notion or PDF link.
            </p>
          </div>
          <div className="p-4 rounded-2xl border border-[#ff9999]/40 bg-[#ffe6cd]/50 dark:bg-[#804000]/20 transition-all shadow-subtle space-y-2">
            <div className="flex items-center gap-2">
              <Tag className="size-4 text-[#600000] dark:text-[#ff9999]" />
              <h4 className="font-semibold text-xs text-foreground font-rubik">VIP Discount Promo</h4>
            </div>
            <p className="text-[#555a6a] dark:text-muted-foreground leading-relaxed text-[11px]">
              Followers comment &ldquo;VIP&rdquo; &rarr; auto DM with unique 20% discount code.
            </p>
          </div>
          <div className="p-4 rounded-2xl border border-[#0fbcb0]/30 bg-[#c3faf5]/50 dark:bg-[#187574]/20 transition-all shadow-subtle space-y-2">
            <div className="flex items-center gap-2">
              <Calendar className="size-4 text-[#187574] dark:text-[#0fbcb0]" />
              <h4 className="font-semibold text-xs text-foreground font-rubik">Discovery Call Link</h4>
            </div>
            <p className="text-[#555a6a] dark:text-muted-foreground leading-relaxed text-[11px]">
              Followers comment &ldquo;CALL&rdquo; &rarr; direct Calendly calendar invite link.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
