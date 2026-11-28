import Link from "next/link";
import { ArrowUpRight, Sparkles } from "lucide-react";

import { Progress } from "@/components/ui/progress";

interface PlanCardProps {
  dmCount: number;
  campaignCount: number;
  contactCount?: number;
}

const DM_LIMIT = 15000;

export function PlanCard({ dmCount, campaignCount, contactCount = 0 }: PlanCardProps) {
  const used = Math.min(dmCount, DM_LIMIT);
  const percent = Math.round((used / DM_LIMIT) * 100);

  const rows = [
    { label: "Monthly DM limit", value: `${used.toLocaleString("en-IN")} / 15K` },
    { label: "Automations", value: campaignCount > 0 ? "Unlimited" : "0 active" },
    { label: "Contacts", value: contactCount > 0 ? contactCount.toLocaleString("en-IN") : "Unlimited" },
    { label: "Messages", value: "Unlimited" },
  ];

  return (
    <section
      aria-labelledby="plan-heading"
      className="overflow-hidden rounded-3xl border border-border bg-card p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-brand-soft-foreground dark:text-brand">
            <Sparkles className="size-3.5" aria-hidden="true" />
            Free Forever
          </p>
          <h2
            id="plan-heading"
            className="mt-1 text-balance text-lg font-semibold tracking-tight text-foreground"
          >
            Upgrade to Unlock your Growth
          </h2>
        </div>
        <Link
          href="/dashboard/settings"
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand px-3.5 py-1.5 text-xs font-bold text-brand-foreground transition-[background-color,box-shadow,transform] hover:bg-brand/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.98]"
        >
          Upgrade
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
          <span>Monthly DM usage</span>
          <span className="font-mono tabular-nums text-foreground">{percent}%</span>
        </div>
        <Progress value={percent} className="h-2" indicatorClassName="bg-brand" />
      </div>

      <dl className="mt-4 divide-y divide-border rounded-2xl border border-border">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs"
          >
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="font-mono font-semibold tabular-nums text-foreground">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      <Link
        href="/dashboard/settings"
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-[13px] border border-border bg-muted/50 px-3.5 py-2 text-sm font-bold text-foreground transition-[background-color,box-shadow] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        Manage Plan
      </Link>
    </section>
  );
}
