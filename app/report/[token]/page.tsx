import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BarChart3,
  Eye,
  MessageCircle,
  ShieldCheck,
  TrendingUp,
  Users,
} from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { loadPublicReport } from "@/lib/public-report";

// The report is token-gated and reads live data, so it must block on the
// server rather than prerender a static shell.
export const instant = false;

export const metadata = {
  title: "Performance report - dmplease",
  robots: { index: false, follow: false },
};

const RANGES = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
] as const;

function formatMoney(minor: number, currency: string): string {
  return `${currency} ${(minor / 100).toLocaleString("en-IN", {
    maximumFractionDigits: 0,
  })}`;
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-[#e0e2e8] dark:border-border bg-[#f7f8fa] dark:bg-muted/30 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6b6f7e]">
        {label}
      </p>
      <p className="mt-1 text-xl font-bold tracking-tight text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default async function PublicReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ days?: string }>;
}) {
  const { token } = await params;
  const daysParam = (await searchParams)?.days;
  const days = daysParam === "7" ? 7 : daysParam === "90" ? 90 : 30;
  const report = await loadPublicReport(token, days);
  if (!report) notFound();

  const maxTrend = Math.max(
    ...report.trend.map((point) => Math.max(point.dms, point.clicks)),
    1
  );

  return (
    <main className="min-h-screen bg-[#f7f8fa] dark:bg-background">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-8 space-y-6">
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4 border-b border-[#e0e2e8] dark:border-border/80">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6b6f7e]">
              Public performance report
            </p>
            <h1 className="text-2xl sm:text-3xl font-medium tracking-tight text-foreground mt-1">
              {report.workspaceName}
            </h1>
            <p className="text-xs text-[#555a6a] dark:text-muted-foreground mt-1">
              Last {report.days} days · {report.timeZone} · generated{" "}
              {new Date(report.generatedAt).toLocaleString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                timeZone: report.timeZone,
              })}
            </p>
          </div>
          <div
            className="flex items-center gap-1 p-1 rounded-full bg-white dark:bg-muted/60 border border-[#e0e2e8] dark:border-border/60 w-fit"
            role="group"
            aria-label="Report date range"
          >
            {RANGES.map((range) => (
              <Link
                key={range.value}
                href={`/report/${token}?days=${range.value}`}
                aria-current={String(report.days) === range.value ? "page" : undefined}
                className={`px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all ${
                  String(report.days) === range.value
                    ? "bg-[#1c1c1e] text-white dark:bg-white dark:text-[#1c1c1e]"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {range.label}
              </Link>
            ))}
          </div>
        </header>

        <section aria-label="Headline metrics" className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Tile label="DMs sent" value={report.totals.dmsSent.toLocaleString()} />
          <Tile
            label="Delivery rate"
            value={
              report.totals.deliveryRate === null
                ? "—"
                : `${report.totals.deliveryRate}%`
            }
            hint={`${report.totals.dmsFailed} failed`}
          />
          <Tile label="Opt-ins" value={report.totals.optIns.toLocaleString()} />
          <Tile label="Link clicks" value={report.totals.linkClicks.toLocaleString()} />
          <Tile
            label="Conversions"
            value={report.totals.conversions.toLocaleString()}
            hint={
              report.totals.revenueMinor > 0
                ? formatMoney(report.totals.revenueMinor, report.totals.currency)
                : "No revenue"
            }
          />
          <Tile label="Comments" value={report.totals.comments.toLocaleString()} />
        </section>

        <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle">
          <CardHeader className="pb-4 border-b border-[#e0e2e8] dark:border-border/60">
            <CardTitle className="text-base font-semibold tracking-tight flex items-center gap-2">
              <BarChart3 className="size-4 text-[#4262ff]" aria-hidden="true" />
              Trend over time
            </CardTitle>
            <CardDescription className="text-xs text-[#555a6a] dark:text-muted-foreground">
              Daily DMs and link clicks.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-5">
            {report.trend.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No activity in this period.
              </p>
            ) : (
              <div
                className="flex items-end gap-1 h-32"
                role="img"
                aria-label={`Daily DMs and clicks for ${report.trend.length} days`}
              >
                {report.trend.map((point) => (
                  <div key={point.day} className="flex-1 flex items-end gap-0.5 min-w-[4px]">
                    <div
                      className="flex-1 rounded-t bg-[#4262ff]/70"
                      style={{
                        height: `${Math.max(4, Math.round((point.dms / maxTrend) * 100))}%`,
                      }}
                      title={`${point.day}: ${point.dms} DMs`}
                    />
                    <div
                      className="flex-1 rounded-t bg-[#00b473]/70"
                      style={{
                        height: `${Math.max(4, Math.round((point.clicks / maxTrend) * 100))}%`,
                      }}
                      title={`${point.day}: ${point.clicks} clicks`}
                    />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle">
            <CardHeader className="pb-4 border-b border-[#e0e2e8] dark:border-border/60">
              <CardTitle className="text-base font-semibold tracking-tight flex items-center gap-2">
                <MessageCircle className="size-4 text-[#4262ff]" aria-hidden="true" />
                Keyword distribution
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-5">
              {report.keywords.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  No keyword activity yet.
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-[#6b6f7e]">
                      <th scope="col" className="py-2 font-semibold">Keyword</th>
                      <th scope="col" className="py-2 font-semibold text-right">DMs</th>
                      <th scope="col" className="py-2 font-semibold text-right">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.keywords.map((row) => (
                      <tr key={row.keyword} className="border-t border-[#e0e2e8]/60 dark:border-border/40">
                        <td className="py-2 font-mono font-semibold text-foreground">{row.keyword}</td>
                        <td className="py-2 text-right font-mono">{row.count}</td>
                        <td className="py-2 text-right font-mono">{row.share}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle">
            <CardHeader className="pb-4 border-b border-[#e0e2e8] dark:border-border/60">
              <CardTitle className="text-base font-semibold tracking-tight flex items-center gap-2">
                <Users className="size-4 text-[#4262ff]" aria-hidden="true" />
                Per-account breakdown
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-5">
              {report.accounts.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  No account activity yet.
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-[#6b6f7e]">
                      <th scope="col" className="py-2 font-semibold">Account</th>
                      <th scope="col" className="py-2 font-semibold text-right">DMs</th>
                      <th scope="col" className="py-2 font-semibold text-right">Delivery</th>
                      <th scope="col" className="py-2 font-semibold text-right">Conv.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.accounts.map((row) => (
                      <tr key={row.id} className="border-t border-[#e0e2e8]/60 dark:border-border/40">
                        <td className="py-2 text-foreground truncate max-w-[160px]">
                          {row.username ? `@${row.username}` : row.id.slice(0, 8)}
                        </td>
                        <td className="py-2 text-right font-mono">{row.dms}</td>
                        <td className="py-2 text-right font-mono">
                          {row.deliveryRate === null ? "—" : `${row.deliveryRate}%`}
                        </td>
                        <td className="py-2 text-right font-mono">{row.conversions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle">
          <CardHeader className="pb-4 border-b border-[#e0e2e8] dark:border-border/60">
            <CardTitle className="text-base font-semibold tracking-tight flex items-center gap-2">
              <TrendingUp className="size-4 text-[#4262ff]" aria-hidden="true" />
              Per-campaign breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-5">
            {report.campaigns.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                No campaign activity yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[520px]">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-[#6b6f7e]">
                      <th scope="col" className="py-2 font-semibold">Campaign</th>
                      <th scope="col" className="py-2 font-semibold text-right">DMs</th>
                      <th scope="col" className="py-2 font-semibold text-right">Clicks</th>
                      <th scope="col" className="py-2 font-semibold text-right">Conversions</th>
                      <th scope="col" className="py-2 font-semibold text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.campaigns.map((row) => (
                      <tr key={row.id} className="border-t border-[#e0e2e8]/60 dark:border-border/40">
                        <td className="py-2 text-foreground truncate max-w-[220px]">{row.name}</td>
                        <td className="py-2 text-right font-mono">{row.dms}</td>
                        <td className="py-2 text-right font-mono">{row.clicks}</td>
                        <td className="py-2 text-right font-mono">{row.conversions}</td>
                        <td className="py-2 text-right font-mono">
                          {row.revenueMinor > 0
                            ? formatMoney(row.revenueMinor, report.totals.currency)
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <footer className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-4 border-t border-[#e0e2e8] dark:border-border/80 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            Read-only report · every figure is query-backed
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Eye className="size-3.5" aria-hidden="true" />
            Generated by dmplease
          </span>
        </footer>
      </div>
    </main>
  );
}
