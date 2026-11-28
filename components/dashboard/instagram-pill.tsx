import Link from "next/link";
import { ExternalLink, Instagram } from "lucide-react";
import { redirect } from "next/navigation";
import { getDashboardShellData } from "@/lib/dashboard-shell-data";
import { Button } from "@/components/ui/button";

/**
 * Streamed slot for the top bar's Instagram status.
 *
 * Kept out of `TopBar` so the top bar (and the sidebar) can render in the
 * static shell without waiting on Supabase.
 */
export async function InstagramPillSlot() {
  const data = await getDashboardShellData();
  if (!data) {
    redirect("/auth/login?next=/dashboard");
  }

  if (!data.instagramUsername) {
    return (
      <Button
        asChild
        size="sm"
        variant="outline"
        className="h-8 rounded-full text-xs font-medium gap-1.5 border-[#c7cad5] hover:bg-[#f7f8fa]"
      >
        <Link href="/dashboard/settings">
          <Instagram className="size-3.5 text-rose-500" />
          <span className="hidden sm:inline">Connect</span> Instagram
        </Link>
      </Button>
    );
  }

  return (
    <a
      href={`https://instagram.com/${data.instagramUsername}`}
      target="_blank"
      rel="noopener noreferrer"
      title={`@${data.instagramUsername} on Instagram`}
      className="flex items-center gap-1.5 px-3 py-1 rounded-full glass-pill border border-[#0fbcb0]/30 text-foreground text-xs font-semibold hover:border-[#0fbcb0] transition-colors shadow-xs"
    >
      <span className="size-1.5 rounded-full bg-[#00b473] animate-pulse" />
      <Instagram className="size-3 text-rose-500" />
      <span className="truncate max-w-[120px]">@{data.instagramUsername}</span>
      <ExternalLink className="size-2.5 text-muted-foreground ml-0.5" />
    </a>
  );
}

/** Same footprint as the status pill so the top bar does not shift. */
export function InstagramPillSkeleton() {
  return <div className="h-8 w-28 rounded-full bg-muted animate-pulse" />;
}
