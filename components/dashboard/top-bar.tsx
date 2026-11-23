"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  PanelLeft,
  Instagram,
  LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { useWorkspace } from "@/lib/workspace-context";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

interface TopBarProps {
  onToggleCollapse: () => void;
  onOpenMobile: () => void;
  userEmail?: string | null;
}

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/dashboard/overview": "Overview & Analytics",
  "/dashboard/inbox": "Direct Inbox",
  "/dashboard/campaigns": "Campaigns & Automations",
  "/dashboard/inbox-automations": "Inbox Automations",
  "/dashboard/logs": "DM Delivery Logs",
  "/dashboard/settings": "Workspace & Instagram Settings",
  "/dashboard/diagnostics": "System Diagnostics",
};

export function TopBar({
  onToggleCollapse,
  onOpenMobile,
  userEmail,
}: TopBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { instagramUsername } = useWorkspace();
  const title = pageTitles[pathname] || "Dashboard";

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
    router.refresh();
  };

  return (
    <header className="h-14 border-b border-border/80 bg-background/90 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between sticky top-0 z-20">
      {/* ── Left: Collapse Trigger & Page Title ── */}
      <div className="flex items-center gap-3">
        {/* Desktop Collapse Trigger */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleCollapse}
          className="hidden md:flex size-8 text-muted-foreground hover:text-foreground"
          title="Toggle Sidebar"
        >
          <PanelLeft className="size-4" />
        </Button>

        {/* Mobile Drawer Trigger */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenMobile}
          className="md:hidden size-8 text-muted-foreground hover:text-foreground"
          title="Open Menu"
        >
          <PanelLeft className="size-4" />
        </Button>

        <Separator orientation="vertical" className="h-4 hidden sm:block" />

        <h1 className="font-semibold text-sm sm:text-base tracking-tight text-foreground truncate">
          {title}
        </h1>
      </div>

      {/* ── Right: Instagram Status, Theme, User Signout ── */}
      <div className="flex items-center gap-2 sm:gap-3">
        {instagramUsername ? (
          <a
            href={`https://instagram.com/${instagramUsername}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-gradient-to-r from-amber-500 via-rose-500 to-purple-600 text-white text-xs font-semibold shadow-xs hover:opacity-95 transition-opacity"
            title="Connected Instagram Account"
          >
            <Instagram className="size-3.5" />
            <span className="truncate max-w-[120px]">@{instagramUsername}</span>
          </a>
        ) : (
          <Button
            asChild
            size="sm"
            variant="outline"
            className="h-8 text-xs font-semibold gap-1.5 border-border hover:bg-muted"
          >
            <Link href="/dashboard/settings">
              <Instagram className="size-3.5 text-rose-500" />
              <span className="hidden sm:inline">Connect</span> Instagram
            </Link>
          </Button>
        )}

        <ThemeSwitcher />

        <Separator orientation="vertical" className="h-4" />

        <Button
          variant="ghost"
          size="icon"
          onClick={handleSignOut}
          className="size-8 text-muted-foreground hover:text-destructive transition-colors"
          title={userEmail ? `Sign out (${userEmail})` : "Sign out"}
        >
          <LogOut className="size-4" />
        </Button>
      </div>
    </header>
  );
}
