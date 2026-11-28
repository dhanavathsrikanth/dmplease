"use client";

import React, { Suspense } from "react";
import { usePathname } from "next/navigation";
import { PanelLeft, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ThemeSwitcher } from "@/components/theme-switcher";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import posthog from "posthog-js";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

interface TopBarProps {
  onToggleCollapse: () => void;
  onOpenMobile: () => void;
  /** Streamed slot: Instagram status pill or connect link. */
  instagramPill: React.ReactNode;
}

const pageTitles: Record<string, { title: string; category: string }> = {
  "/dashboard": { title: "Dashboard", category: "Workspace" },
  "/dashboard/overview": { title: "Analytics", category: "Workspace" },
  "/dashboard/inbox": { title: "Inbox", category: "Workspace" },
  "/dashboard/contacts": { title: "Contacts", category: "Workspace" },
  "/dashboard/campaigns": { title: "Campaigns", category: "Automations" },
  "/dashboard/campaigns/new": { title: "New campaign", category: "Automations" },
  "/dashboard/inbox-automations": { title: "Auto-replies", category: "Automations" },
  "/dashboard/logs": { title: "Activity Log", category: "Automations" },
  "/dashboard/settings": { title: "Settings", category: "Platform" },
  "/dashboard/diagnostics": { title: "System Health", category: "Platform" },
  "/dashboard/safety": { title: "Safety", category: "Platform" },
};

function Breadcrumb({
  title,
  category,
}: {
  title: string;
  category: string;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-[#6b6f7e] dark:text-[#9aa0ad] hidden sm:inline font-medium">
        {category}
      </span>
      <span className="text-[#c7cad5] hidden sm:inline">/</span>
      <h1 className="font-semibold text-xs sm:text-sm tracking-tight text-foreground truncate">
        {title}
      </h1>
    </div>
  );
}

/**
 * `usePathname` is URL data and must sit behind Suspense so the rest of the
 * top bar can prerender into the static shell.
 */
function ActiveBreadcrumb() {
  const pathname = usePathname();
  const pageInfo = pageTitles[pathname] || {
    title: "Dashboard",
    category: "Workspace",
  };
  return <Breadcrumb title={pageInfo.title} category={pageInfo.category} />;
}

export function TopBar({
  onToggleCollapse,
  onOpenMobile,
  instagramPill,
}: TopBarProps) {
  const router = useRouter();

  const handleSignOut = async () => {
    posthog.reset();

    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
    router.refresh();
  };

  return (
    <header className="h-14 glass-panel border-b border-[#e0e2e8]/80 dark:border-border/80 px-4 sm:px-6 flex items-center justify-between sticky top-0 z-20 antialiased">
      <TooltipProvider delayDuration={200}>
        {/* ── Left: Collapse Trigger & Breadcrumb ── */}
        <div className="flex items-center gap-2.5">
          {/* Desktop Collapse Trigger */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleCollapse}
                aria-label="Toggle sidebar"
                className="hidden md:flex size-8 rounded-full text-muted-foreground hover:text-foreground"
              >
                <PanelLeft className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Toggle sidebar</TooltipContent>
          </Tooltip>

          {/* Mobile Drawer Trigger */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onOpenMobile}
                aria-label="Open navigation"
                className="md:hidden size-8 rounded-full text-muted-foreground hover:text-foreground"
              >
                <PanelLeft className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Open navigation</TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="h-4 hidden sm:block" />

          {/* Breadcrumb Display */}
          <Suspense fallback={<Breadcrumb title="Dashboard" category="Workspace" />}>
            <ActiveBreadcrumb />
          </Suspense>
        </div>

        {/* ── Right: Instagram Status Pill, Theme, User Signout ── */}
        <div className="flex items-center gap-2 sm:gap-3">
          {instagramPill}

          <ThemeSwitcher />

          <Separator orientation="vertical" className="h-4" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleSignOut}
                aria-label="Sign out"
                className="size-8 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <LogOut className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Sign out</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </header>
  );
}
