import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock } from "lucide-react";

interface RecentActivityCardProps {
  logs: Array<{
    id: string;
    user: string;
    keyword: string;
    time: string;
    status: string;
  }>;
}

export function RecentActivityCard({ logs }: RecentActivityCardProps) {
  return (
    <section
      aria-labelledby="recent-activity-heading"
      className="overflow-hidden rounded-3xl border border-border bg-card"
    >
      <div className="flex items-center justify-between gap-3 p-4 pb-3">
        <h2
          id="recent-activity-heading"
          className="flex items-center gap-2 text-base font-semibold text-foreground"
        >
          <span
            className="size-2 rounded-full bg-success animate-pulse motion-reduce:animate-none"
            aria-hidden="true"
          />
          Recent activity
        </h2>
        <Link
          href="/dashboard/logs"
          className="inline-flex items-center gap-1 text-xs font-semibold text-info transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          View all
          <ArrowRight className="size-3" aria-hidden="true" />
        </Link>
      </div>

      <div className="px-4 pb-4">
        {logs.length > 0 ? (
          <ol className="divide-y divide-border rounded-2xl border border-border">
            {logs.map((log) => (
              <li
                key={log.id}
                className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">
                    {log.user}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                    keyword:
                    <span className="rounded-full bg-brand-soft px-1.5 py-0.5 font-semibold text-brand-soft-foreground">
                      {log.keyword}
                    </span>
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-success-soft-foreground dark:text-success-soft-foreground">
                    <CheckCircle2 className="size-3" aria-hidden="true" />
                    {log.status}
                  </span>
                  <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                    {log.time}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="rounded-2xl border border-dashed border-border py-8 text-center">
            <div className="mx-auto flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Clock className="size-4" aria-hidden="true" />
            </div>
            <p className="mt-2 text-xs font-semibold text-foreground">
              Waiting for comments
            </p>
            <p className="mx-auto mt-1 max-w-xs text-[11px] text-muted-foreground">
              When someone comments on your connected account, real-time
              dispatch logs appear here.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
