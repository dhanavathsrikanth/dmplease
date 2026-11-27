import type { ReactNode } from "react";
import { Eye, MousePointerClick, Share2, Users } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MetricInfo } from "@/components/ui/metric-info";
import { DeltaBadge } from "@/components/ui/delta-badge";
import type { ShareSummary } from "@/lib/share-analytics";
import type { CampaignComparison } from "@/lib/period-comparison";

function Tile({
  label,
  value,
  hint,
  info,
  delta,
}: {
  label: string;
  value: string | number;
  hint?: string;
  info?: string;
  delta?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[#e0e2e8] dark:border-border bg-[#f7f8fa] dark:bg-muted/30 px-3 py-2.5">
      <div className="flex items-center gap-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6b6f7e]">
          {label}
        </p>
        {info && <MetricInfo label={label} description={info} />}
      </div>
      <p className="mt-1 text-xl font-bold tracking-tight text-foreground">{value}</p>
      {delta && <div className="mt-0.5">{delta}</div>}
      {hint && <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ShareFunnel({ data }: { data: ShareSummary }) {
  const stages = [
    { label: "Shares", value: data.sharesReceived, color: "bg-[#4262ff]" },
    { label: "Thank-you DMs", value: data.dmsSent, color: "bg-[#00b473]" },
    { label: "Clicks", value: data.clicks, color: "bg-[#f59e0b]" },
  ];
  const max = Math.max(...stages.map((stage) => stage.value), 1);
  return (
    <div className="rounded-xl border border-[#e0e2e8] dark:border-border p-4 space-y-2.5">
      <p className="text-xs font-semibold text-foreground">Share funnel</p>
      <ol className="space-y-2" aria-label="Share to click funnel">
        {stages.map((stage) => (
          <li key={stage.label} className="space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-medium text-foreground">{stage.label}</span>
              <span className="text-muted-foreground">{stage.value.toLocaleString()}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${stage.color}`}
                style={{ width: `${Math.max(2, Math.round((stage.value / max) * 100))}%` }}
              />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function SharePerformance({
  data,
  comparison,
}: {
  data: ShareSummary;
  comparison: CampaignComparison;
}) {
  const hasData = data.sharesReceived > 0 || data.dmsSent > 0;

  return (
    <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle">
      <CardHeader className="pb-4 border-b border-[#e0e2e8] dark:border-border/60">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base font-semibold tracking-tight flex items-center gap-2">
              <Share2 className="size-4 text-[#4262ff]" aria-hidden="true" />
              Share performance
            </CardTitle>
            <CardDescription className="text-xs mt-0.5 text-[#555a6a] dark:text-muted-foreground">
              Shares received, thank-you DMs sent, and which shared media drove clicks.
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-[10px] font-semibold rounded-full px-3">
            {data.sharesReceived} share{data.sharesReceived === 1 ? "" : "s"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-5 space-y-5">
        {!hasData ? (
          <p role="status" className="py-8 text-center text-sm text-muted-foreground">
            No shares yet. When someone shares your reel or post into your DM, the
            share and the thank-you DM appear here.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Tile
                label="Shares received"
                value={data.sharesReceived}
                hint={`${data.uniqueSharers} unique ${data.uniqueSharers === 1 ? "person" : "people"}`}
                info="Every time someone shared your reel or post into your DM."
                delta={<DeltaBadge comparison={comparison.sharesReceived} periodLabel="vs prev" />}
              />
              <Tile
                label="Thank-you DMs"
                value={data.dmsSent}
                hint={data.dmsFailed > 0 ? `${data.dmsFailed} failed` : "Delivered"}
                info="Share-triggered DMs delivered by Meta."
                delta={<DeltaBadge comparison={comparison.shareDmsSent} periodLabel="vs prev" />}
              />
              <Tile
                label="Share → DM rate"
                value={data.shareToDmRate === null ? "—" : `${data.shareToDmRate}%`}
                hint={data.skipped > 0 ? `${data.skipped} skipped` : "No duplicates"}
                info="Shares that became a delivered DM."
                delta={<DeltaBadge comparison={comparison.shareToDmRate} periodLabel="vs prev" />}
              />
              <Tile
                label="Link clicks"
                value={data.clicks}
                hint="From share DMs"
                info="Human clicks on links sent in share-triggered DMs."
                delta={<DeltaBadge comparison={comparison.shareClicks} periodLabel="vs prev" />}
              />
            </div>

            <ShareFunnel data={data} />

            {data.topMedia.length > 0 && (
              <div className="rounded-xl border border-[#e0e2e8] dark:border-border overflow-hidden">
                <div className="px-3.5 py-2.5 border-b border-[#e0e2e8] dark:border-border/60 flex items-center gap-2">
                  <Eye className="size-3.5 text-[#4262ff]" aria-hidden="true" />
                  <p className="text-xs font-semibold text-foreground">Top shared media</p>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-[#6b6f7e]">
                      <th scope="col" className="px-3.5 py-2 font-semibold">Media</th>
                      <th scope="col" className="px-3.5 py-2 font-semibold text-right">Shares</th>
                      <th scope="col" className="px-3.5 py-2 font-semibold text-right">DMs</th>
                      <th scope="col" className="px-3.5 py-2 font-semibold text-right">Clicks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topMedia.map((item) => (
                      <tr
                        key={item.mediaId}
                        className="border-t border-[#e0e2e8]/60 dark:border-border/40"
                      >
                        <td className="px-3.5 py-2 text-foreground truncate max-w-[220px]">
                          {item.title || item.mediaId}
                        </td>
                        <td className="px-3.5 py-2 text-right font-mono">{item.shares}</td>
                        <td className="px-3.5 py-2 text-right font-mono">{item.dms}</td>
                        <td className="px-3.5 py-2 text-right font-mono">{item.clicks}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Users className="size-3.5" aria-hidden="true" />
                {data.uniqueSharers} unique sharer{data.uniqueSharers === 1 ? "" : "s"}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <MousePointerClick className="size-3.5" aria-hidden="true" />
                {data.clicks} human click{data.clicks === 1 ? "" : "s"}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
