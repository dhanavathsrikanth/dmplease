import Link from "next/link";
import { CalendarDays, CheckCircle2, MousePointerClick, Send, TrendingUp } from "lucide-react";

import { NumberTicker } from "@/components/ui/number-ticker";

interface GrowthCardProps {
  conversionRate: number | null;
  sent: number;
  delivered: number;
  leads: number;
}

export function GrowthCard({
  conversionRate,
  sent,
  delivered,
  leads,
}: GrowthCardProps) {
  const max = Math.max(sent, delivered, leads, 1);
  const bars = [
    { label: "Sent", value: sent, color: "bg-brand" },
    { label: "Delivered", value: delivered, color: "bg-success" },
    { label: "Leads", value: leads, color: "bg-info" },
  ];

  return (
    <section
      aria-labelledby="growth-heading"
      className="overflow-hidden rounded-3xl border border-border bg-card"
    >
      <div className="flex items-center justify-between gap-3 p-4 pb-3">
        <h2
          id="growth-heading"
          className="text-base font-semibold text-foreground"
        >
          Growth &amp; Engagement
        </h2>
        <Link
          href="/dashboard/overview?range=30d"
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <CalendarDays className="size-3.5" aria-hidden="true" />
          Last 30 days
        </Link>
      </div>

      <div className="flex flex-col gap-2 px-4 pb-4">
        <div className="relative overflow-hidden rounded-[23px] border border-border bg-muted/40 pt-2">
          <div className="flex items-center px-3 py-2">
            <div className="mr-auto flex items-center gap-2 text-xs font-semibold text-foreground">
              <TrendingUp
                className="size-4 text-success-soft-foreground dark:text-success-soft-foreground"
                aria-hidden="true"
              />
              Conversion
            </div>
            <span className="text-sm font-bold tabular-nums text-success-soft-foreground dark:text-success-soft-foreground">
              {conversionRate === null ? (
                "—"
              ) : (
                <NumberTicker value={conversionRate} suffix="%" />
              )}
            </span>
          </div>

          <div className="flex items-stretch gap-2 p-0.5">
            <div className="min-w-fit flex-1 rounded-l-[72px] rounded-r-[30px] border border-border bg-card px-4 py-3">
              <div className="flex items-center gap-2">
                <Send className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <span className="text-lg font-bold tabular-nums text-foreground">
                  <NumberTicker value={sent} />
                </span>
              </div>
              <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
                Sent
              </p>
            </div>

            <div className="min-w-fit flex-1 rounded-[30px] border border-border bg-card px-4 py-3">
              <div className="flex items-center gap-2">
                <CheckCircle2
                  className="size-3.5 text-success-soft-foreground dark:text-success-soft-foreground"
                  aria-hidden="true"
                />
                <span className="text-lg font-bold tabular-nums text-foreground">
                  <NumberTicker value={delivered} />
                </span>
              </div>
              <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
                Delivered
              </p>
            </div>

            <div className="min-w-fit flex-1 rounded-[30px] border border-border bg-card px-4 py-3">
              <div className="flex items-center gap-2">
                <MousePointerClick
                  className="size-3.5 text-info"
                  aria-hidden="true"
                />
                <span className="text-lg font-bold tabular-nums text-foreground">
                  <NumberTicker value={leads} />
                </span>
              </div>
              <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
                Leads
              </p>
            </div>
          </div>

          <div className="mt-2 rounded-2xl border border-border bg-card p-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Delivery mix
              </p>
              <p className="text-[10px] font-medium text-muted-foreground">
                Last 30 days
              </p>
            </div>
            <div className="mt-3 space-y-2.5">
              {bars.map((bar) => (
                <div key={bar.label} className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-medium text-muted-foreground">
                      {bar.label}
                    </span>
                    <span className="font-mono font-semibold tabular-nums text-foreground">
                      {bar.value.toLocaleString("en-IN")}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${bar.color} transition-[width] duration-500`}
                      style={{ width: `${Math.max(4, (bar.value / max) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
