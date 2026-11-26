import { Skeleton } from "@/components/ui/skeleton";

/**
 * Instant fallback for client-side sidebar navigation. Shared layouts stay
 * mounted, so this skeleton appears immediately while the destination page's
 * data streams in.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6 animate-pulse" aria-hidden="true">
      <div className="space-y-2 pb-3 border-b border-[#e0e2e8] dark:border-border/80">
        <Skeleton className="h-8 w-56 rounded-xl" />
        <Skeleton className="h-4 w-80 rounded-lg" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-64 rounded-2xl lg:col-span-2" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    </div>
  );
}
