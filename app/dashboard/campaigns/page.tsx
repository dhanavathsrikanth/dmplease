import { Suspense } from "react";
import { connection } from "next/server";
import { getCurrentProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { Skeleton } from "@/components/ui/skeleton";
import { ZorchaAutomations } from "@/components/campaigns/zorcha-automations";

export const metadata = {
  title: "Automations - dmplease",
};

function CampaignsSkeleton() {
  return (
    <div className="space-y-6 animate-pulse motion-reduce:animate-none">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <Skeleton className="h-8 w-60 rounded-xl" />
        <Skeleton className="h-9 w-36 rounded-full" />
      </div>
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
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
    <ZorchaAutomations
      initialAutomations={allAutomations}
      logCountsByAutoId={logCountsByAutoId}
      created={created === "1"}
      saved={saved === "1"}
    />
  );
}
