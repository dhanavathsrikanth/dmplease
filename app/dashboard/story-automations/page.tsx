import { Suspense } from "react";
import { connection } from "next/server";
import { Sparkles } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import {
  StoryAutomationBuilder,
} from "@/components/story/story-automation-builder";
import type {
  DmRuleItem,
  DmRuleTrigger,
  WorkspaceOption,
} from "@/components/inbox-rules/rule-manager";

export const metadata = {
  title: "Story to DM - dmplease",
};

const STORY_TRIGGERS: DmRuleTrigger[] = [
  "STORY_REPLY",
  "STORY_MENTION",
  "MESSAGE_REACTION",
];

interface RuleRow {
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

function StorySkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <Skeleton className="h-8 w-64 rounded-xl" />
      <Skeleton className="h-[620px] rounded-2xl" />
    </div>
  );
}

export default function StoryAutomationsPage() {
  return (
    <Suspense fallback={<StorySkeleton />}>
      <StoryAutomationsContent />
    </Suspense>
  );
}

async function StoryAutomationsContent() {
  await connection();
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  const ownedWorkspaces = profile?.ownedWorkspaces || [];
  const workspaceIds = ownedWorkspaces.map((workspace) => workspace.id);
  const workspaces: WorkspaceOption[] = ownedWorkspaces.map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
  }));

  let rules: DmRuleItem[] = [];
  if (workspaceIds.length > 0) {
    const { data, error } = await supabase
      .from("dm_rules")
      .select(
        "id, workspace_id, name, trigger_type, keywords, message, button_text, button_url, collect_field, follow_gate_enabled, opening_message, follow_gate_button_label, follow_gate_on_unavailable, once_per_days, priority, active, created_at"
      )
      .in("workspace_id", workspaceIds)
      .in("trigger_type", STORY_TRIGGERS)
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("[story-automations] Could not load rules:", error.message);
    } else {
      rules = ((data ?? []) as RuleRow[]).map((row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        name: row.name || "Story auto-DM",
        triggerType: STORY_TRIGGERS.includes(row.trigger_type as DmRuleTrigger)
          ? (row.trigger_type as DmRuleTrigger)
          : "STORY_REPLY",
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
    <div className="space-y-6 animate-in fade-in duration-300 antialiased">
      <div className="pb-3 border-b border-[#e0e2e8] dark:border-border/80">
        <h1 className="text-2xl sm:text-3xl font-medium tracking-tight text-foreground flex items-center gap-2">
          <Sparkles className="size-6 text-[#ff6b8a]" aria-hidden="true" />
          Story to DM
        </h1>
        <p className="text-[#555a6a] dark:text-muted-foreground text-xs sm:text-sm mt-0.5">
          Reply to story reactions, mentions and replies — with an optional verified follow gate.
        </p>
      </div>
      <StoryAutomationBuilder initialRules={rules} workspaces={workspaces} />
    </div>
  );
}
