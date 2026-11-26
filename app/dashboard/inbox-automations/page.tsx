import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { Plus, Instagram, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RuleManager,
  type DmRuleItem,
  type DmRuleTrigger,
  type WorkspaceOption,
} from "@/components/inbox-rules/rule-manager";
import { getCurrentProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Inbox Automations - dmplease",
};

interface DmRuleRow {
  id: string;
  workspace_id: string;
  name: string;
  trigger_type: string;
  keywords: string[] | null;
  message: string;
  button_text: string | null;
  button_url: string | null;
  collect_field: string | null;
  follow_gate_enabled: boolean | null;
  opening_message: string | null;
  follow_gate_button_label: string | null;
  follow_gate_on_unavailable: string | null;
  once_per_days: number | null;
  priority: number | null;
  active: boolean | null;
  created_at: string;
}

const KNOWN_TRIGGERS: DmRuleTrigger[] = [
  "DM_KEYWORD",
  "STORY_REPLY",
  "STORY_MENTION",
  "SHARE_TO_DM",
  "MESSAGE_REACTION",
];

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

  const ownedWorkspaces = profile?.ownedWorkspaces || [];
  const workspaceIds = ownedWorkspaces.map((workspace) => workspace.id);
  const workspaceOptions: WorkspaceOption[] = ownedWorkspaces.map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
  }));

  let isConnected = false;
  let rules: DmRuleItem[] = [];

  if (workspaceIds.length > 0) {
    const { data: accounts } = await supabase
      .from("instagram_accounts")
      .select("username")
      .in("workspace_id", workspaceIds)
      .limit(1);

    isConnected = Boolean(accounts && accounts.length > 0);

    const { data: ruleRows, error } = await supabase
      .from("dm_rules")
      .select(
        "id, workspace_id, name, trigger_type, keywords, message, button_text, button_url, collect_field, follow_gate_enabled, opening_message, follow_gate_button_label, follow_gate_on_unavailable, once_per_days, priority, active, created_at"
      )
      .in("workspace_id", workspaceIds)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("[inbox-automations] Could not load rules:", error.message);
    } else if (ruleRows) {
      rules = (ruleRows as DmRuleRow[]).map((row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        name: row.name || "Untitled rule",
        triggerType: KNOWN_TRIGGERS.includes(row.trigger_type as DmRuleTrigger)
          ? (row.trigger_type as DmRuleTrigger)
          : "DM_KEYWORD",
        keywords: Array.isArray(row.keywords) ? row.keywords : [],
        message: row.message || "",
        buttonText: row.button_text,
        buttonUrl: row.button_url,
        collectField: row.collect_field,
        followGateEnabled: Boolean(row.follow_gate_enabled),
        openingMessage: row.opening_message,
        followGateButtonLabel: row.follow_gate_button_label,
        followGateOnUnavailable:
          row.follow_gate_on_unavailable === "deliver" ? "deliver" : "hold",
        oncePerDays: row.once_per_days ?? 45,
        priority: row.priority ?? 0,
        active: Boolean(row.active),
        createdAt: row.created_at,
      }));
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300 antialiased selection:bg-[#ffd02f] selection:text-[#1c1c1e]">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-[#e0e2e8] dark:border-border/80">
        <div>
          <h1 className="text-2xl sm:text-3xl font-medium tracking-tight text-foreground flex items-center gap-2">
            Inbox &amp; Story Automations
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

      <RuleManager initialRules={rules} workspaces={workspaceOptions} />
    </div>
  );
}
