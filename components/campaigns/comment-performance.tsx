"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import {
  BarChart3,
  Clock,
  MessageCircle,
  MousePointerClick,
  TrendingUp,
  Users,
} from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MetricInfo } from "@/components/ui/metric-info";
import { DeltaBadge } from "@/components/ui/delta-badge";
import { CommentHeatmap } from "@/components/campaigns/comment-heatmap";
import type { CommentSummary } from "@/lib/comment-analytics";
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

function Funnel({ data }: { data: CommentSummary }) {
  const stages = [
    { label: "Comments", value: data.commentsReceived, color: "bg-[#4262ff]" },
    { label: "Matched", value: data.matchedComments, color: "bg-[#8b5cf6]" },
    { label: "DMs sent", value: data.dmsSent, color: "bg-[#00b473]" },
    { label: "Clicks", value: data.clicks, color: "bg-[#f59e0b]" },
    { label: "Conversions", value: data.conversions, color: "bg-[#d62976]" },
  ];
  const max = Math.max(...stages.map((stage) => stage.value), 1);

  return (
    <div className="rounded-xl border border-[#e0e2e8] dark:border-border p-4 space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-foreground">Conversion funnel</p>
        <p className="text-[10px] text-muted-foreground">Each step vs the one above</p>
      </div>
      <ol className="space-y-2" aria-label="Comment to conversion funnel">
        {stages.map((stage, index) => {
          const previous = index > 0 ? stages[index - 1].value : stage.value;
          const drop =
            index > 0 && previous > 0
              ? Math.round((stage.value / previous) * 100)
              : null;
          return (
            <li key={stage.label} className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-medium text-foreground">{stage.label}</span>
                <span className="text-muted-foreground">
                  {stage.value.toLocaleString()}
                  {drop !== null && (
                    <span className="ml-1.5 font-mono text-[10px]">
                      {drop}% of previous
                    </span>
                  )}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${stage.color}`}
                  style={{ width: `${Math.max(2, Math.round((stage.value / max) * 100))}%` }}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function formatMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

export function CommentPerformance({
  data,
  comparison,
  timeZone,
  weekStartsOn,
}: {
  data: CommentSummary;
  comparison: CampaignComparison;
  timeZone: string;
  weekStartsOn: number;
}) {
  const hasData = data.commentsReceived > 0 || data.dmsSent > 0;
  const [selectedKeyword, setSelectedKeyword] = useState<string | null>(null);
  const activeKeyword = selectedKeyword
    ? data.keywords.find((row) => row.keyword === selectedKeyword) ?? null
    : null;
  const trend = activeKeyword?.daily ?? data.daily;
  const posts = activeKeyword?.posts ?? data.posts;
  const mediaTypes = activeKeyword
    ? Object.values(
        activeKeyword.posts.reduce<
          Record<string, { type: string; comments: number; dms: number }>
        >((acc, post) => {
          const type = post.mediaType.toUpperCase();
          acc[type] = acc[type] ?? { type, comments: 0, dms: 0 };
          acc[type].comments += post.comments;
          acc[type].dms += post.dms;
          return acc;
        }, {})
      )
    : data.mediaTypes;
  const maxDaily = Math.max(
    ...trend.map((point) => Math.max(point.comments, point.dms)),
    1
  );
  const topKeyword = data.keywords[0];
  const insight = topKeyword
    ? `${topKeyword.keyword} is your top keyword with ${topKeyword.comments.toLocaleString()} comments and ${topKeyword.conversions.toLocaleString()} conversions.`
    : null;

  return (
    <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle">
      <CardHeader className="pb-4 border-b border-[#e0e2e8] dark:border-border/60">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base font-semibold tracking-tight flex items-center gap-2">
              <MessageCircle className="size-4 text-[#4262ff]" aria-hidden="true" />
              Comment keyword performance
            </CardTitle>
            <CardDescription className="text-xs mt-0.5 text-[#555a6a] dark:text-muted-foreground">
              Comments, keyword matches, DMs, clicks and conversions for this campaign.
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-[10px] font-semibold rounded-full px-3">
            {data.commentsReceived} comment{data.commentsReceived === 1 ? "" : "s"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-5 space-y-5">
        {!hasData ? (
          <p role="status" className="py-8 text-center text-sm text-muted-foreground">
            No comments yet. When someone comments your keyword, the comment, DM,
            click and conversion appear here.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <Tile
                label="Comments"
                value={data.commentsReceived}
                hint={`${data.uniqueCommenters} unique`}
                info="Every comment received on the campaign's media in the selected period."
                delta={<DeltaBadge comparison={comparison.commentsReceived} periodLabel="vs prev" />}
              />
              <Tile
                label="Matched"
                value={data.matchedComments}
                hint={`${data.skipped} skipped`}
                info="Comments that contained one of the campaign's keywords."
                delta={<DeltaBadge comparison={comparison.matchedComments} periodLabel="vs prev" />}
              />
              <Tile
                label="DMs sent"
                value={data.dmsSent}
                hint={data.dmsFailed > 0 ? `${data.dmsFailed} failed` : "Delivered"}
                info="Automated DMs delivered by Meta."
                delta={<DeltaBadge comparison={comparison.commentDmsSent} periodLabel="vs prev" />}
              />
              <Tile
                label="Comment → DM"
                value={data.commentToDmRate === null ? "—" : `${data.commentToDmRate}%`}
                hint="Match to delivery"
                info="Matched comments that became a delivered DM."
                delta={<DeltaBadge comparison={comparison.commentToDmRate} periodLabel="vs prev" />}
              />
              <Tile
                label="Clicks"
                value={data.clicks}
                hint="Human clicks"
                info="Human clicks on the campaign's tracked links (bots excluded)."
                delta={<DeltaBadge comparison={comparison.commentClicks} periodLabel="vs prev" />}
              />
              <Tile
                label="Conversions"
                value={data.conversions}
                hint={
                  data.revenueMinor > 0
                    ? `₹${(data.revenueMinor / 100).toLocaleString("en-IN")}`
                    : "No revenue yet"
                }
                info="Server-verified purchases or leads reported by your checkout."
                delta={<DeltaBadge comparison={comparison.commentConversions} periodLabel="vs prev" />}
              />
            </div>

            {insight && (
              <p className="rounded-xl border border-[#4262ff]/25 bg-[#f5f3ff]/60 dark:bg-[#4262ff]/10 px-3.5 py-2.5 text-[11px] text-[#555a6a] dark:text-muted-foreground">
                <span className="font-semibold text-foreground">Insight:</span> {insight}
              </p>
            )}

            <Funnel data={data} />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Tile
                label="Avg order value"
                value={
                  data.averageOrderValueMinor === null
                    ? "—"
                    : `₹${(data.averageOrderValueMinor / 100).toLocaleString("en-IN")}`
                }
                hint="Revenue ÷ conversions"
                info="Revenue divided by the number of conversions."
                delta={<DeltaBadge comparison={comparison.averageOrderValueMinor} periodLabel="vs prev" />}
              />
              <Tile
                label="Revenue per DM"
                value={
                  data.revenuePerDmMinor === null
                    ? "—"
                    : `₹${(data.revenuePerDmMinor / 100).toLocaleString("en-IN")}`
                }
                hint="Revenue ÷ DMs sent"
                info="Revenue divided by the number of DMs sent."
                delta={<DeltaBadge comparison={comparison.revenuePerDmMinor} periodLabel="vs prev" />}
              />
              <Tile
                label="Click → conversion"
                value={
                  data.clickToConversionRate === null
                    ? "—"
                    : `${data.clickToConversionRate}%`
                }
                hint="Conversions ÷ human clicks"
                info="Conversions divided by human clicks."
                delta={<DeltaBadge comparison={comparison.clickToConversionRate} periodLabel="vs prev" />}
              />
            </div>

            <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Users className="size-3.5" aria-hidden="true" />
                {data.uniqueCommenters} unique commenter{data.uniqueCommenters === 1 ? "" : "s"}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="size-3.5" aria-hidden="true" />
                Avg reply {formatMs(data.avgResponseMs)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <MousePointerClick className="size-3.5" aria-hidden="true" />
                {data.clicks} click{data.clicks === 1 ? "" : "s"}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <TrendingUp className="size-3.5" aria-hidden="true" />
                {data.conversions} conversion{data.conversions === 1 ? "" : "s"}
              </span>
            </div>

            {data.conversions === 0 && (
              <p className="text-[11px] text-muted-foreground">
                Revenue appears after you connect your checkout with the conversion
                token.{" "}
                <Link
                  href="/dashboard/settings"
                  className="font-semibold text-[#4262ff] hover:underline dark:text-[#ffd02f]"
                >
                  Open Settings
                </Link>
              </p>
            )}

            {activeKeyword && (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-[#4262ff]/30 bg-[#f5f3ff]/60 dark:bg-[#4262ff]/10 px-3.5 py-2">
                <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground">
                  Showing trend and posts for{" "}
                  <span className="font-mono font-semibold text-foreground">
                    {activeKeyword.keyword}
                  </span>
                </p>
                <button
                  type="button"
                  onClick={() => setSelectedKeyword(null)}
                  className="text-[11px] font-semibold text-[#4262ff] hover:underline dark:text-[#ffd02f]"
                >
                  Clear filter
                </button>
              </div>
            )}

            {trend.length > 0 && (
              <div className="rounded-xl border border-[#e0e2e8] dark:border-border p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-foreground flex items-center gap-2">
                    <BarChart3 className="size-3.5 text-[#4262ff]" aria-hidden="true" />
                    Daily comments vs DMs
                    {activeKeyword && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        · {activeKeyword.keyword}
                      </span>
                    )}
                  </p>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <span className="size-2 rounded-sm bg-[#4262ff]" aria-hidden="true" />
                      Comments
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="size-2 rounded-sm bg-[#00b473]" aria-hidden="true" />
                      DMs
                    </span>
                  </div>
                </div>
                <div
                  className="flex items-end gap-1 h-24"
                  role="img"
                  aria-label={`Daily comments and DMs for the last ${trend.length} days${activeKeyword ? ` for ${activeKeyword.keyword}` : ""}`}
                >
                  {trend.map((point) => (
                    <div key={point.day} className="flex-1 flex items-end gap-0.5 min-w-[4px]">
                      <div
                        className="flex-1 rounded-t bg-[#4262ff]/70"
                        style={{
                          height: `${Math.max(4, Math.round((point.comments / maxDaily) * 100))}%`,
                        }}
                        title={`${point.day}: ${point.comments} comments`}
                      />
                      <div
                        className="flex-1 rounded-t bg-[#00b473]/70"
                        style={{
                          height: `${Math.max(4, Math.round((point.dms / maxDaily) * 100))}%`,
                        }}
                        title={`${point.day}: ${point.dms} DMs`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <CommentHeatmap
              times={activeKeyword?.times ?? data.times}
              timeZone={timeZone}
              weekStartsOn={weekStartsOn}
            />

            {data.keywords.length > 0 && (
              <div className="rounded-xl border border-[#e0e2e8] dark:border-border overflow-hidden">
                <div className="px-3.5 py-2.5 border-b border-[#e0e2e8] dark:border-border/60">
                  <p className="text-xs font-semibold text-foreground">Keyword breakdown</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Click a keyword to filter the trend and posts below.
                  </p>
                </div>
                <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[520px]">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-[#6b6f7e]">
                      <th scope="col" className="px-3.5 py-2 font-semibold">Keyword</th>
                      <th scope="col" className="px-3.5 py-2 font-semibold text-right">Comments</th>
                      <th scope="col" className="px-3.5 py-2 font-semibold text-right">DMs</th>
                      <th scope="col" className="px-3.5 py-2 font-semibold text-right">Clicks</th>
                      <th scope="col" className="px-3.5 py-2 font-semibold text-right">Conv.</th>
                      <th scope="col" className="px-3.5 py-2 font-semibold text-right">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.keywords.map((row) => {
                      const isSelected = selectedKeyword === row.keyword;
                      return (
                        <tr
                          key={row.keyword}
                          className={`border-t border-[#e0e2e8]/60 dark:border-border/40 ${
                            isSelected ? "bg-[#f5f3ff]/70 dark:bg-[#4262ff]/10" : ""
                          }`}
                        >
                          <td className="px-3.5 py-2 font-mono font-semibold text-foreground">
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedKeyword(isSelected ? null : row.keyword)
                              }
                              aria-pressed={isSelected}
                              aria-label={`Filter trend and posts by ${row.keyword}`}
                              className="rounded hover:text-[#4262ff] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {row.keyword}
                            </button>
                          </td>
                          <td className="px-3.5 py-2 text-right font-mono">{row.comments}</td>
                          <td className="px-3.5 py-2 text-right font-mono">{row.dms}</td>
                          <td className="px-3.5 py-2 text-right font-mono">{row.clicks}</td>
                          <td className="px-3.5 py-2 text-right font-mono">{row.conversions}</td>
                          <td className="px-3.5 py-2 text-right font-mono">
                            {row.commentToDmRate === null ? "—" : `${row.commentToDmRate}%`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </div>
            )}

            {posts.length > 0 && (
              <div className="rounded-xl border border-[#e0e2e8] dark:border-border overflow-hidden">
                <div className="px-3.5 py-2.5 border-b border-[#e0e2e8] dark:border-border/60">
                  <p className="text-xs font-semibold text-foreground">
                    Top posts &amp; reels
                    {activeKeyword && (
                      <span className="ml-1.5 font-mono text-[10px] font-normal text-muted-foreground">
                        · {activeKeyword.keyword}
                      </span>
                    )}
                  </p>
                </div>
                <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[520px]">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-[#6b6f7e]">
                      <th scope="col" className="px-3.5 py-2 font-semibold">Media</th>
                      <th scope="col" className="px-3.5 py-2 font-semibold">Type</th>
                      <th scope="col" className="px-3.5 py-2 font-semibold text-right">Comments</th>
                      <th scope="col" className="px-3.5 py-2 font-semibold text-right">DMs</th>
                      <th scope="col" className="px-3.5 py-2 font-semibold text-right">Clicks</th>
                      <th scope="col" className="px-3.5 py-2 font-semibold text-right">Conv.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {posts.map((post) => (
                      <tr
                        key={post.mediaId}
                        className="border-t border-[#e0e2e8]/60 dark:border-border/40"
                      >
                        <td className="px-3.5 py-2 text-foreground truncate max-w-[200px]">
                          {post.mediaId}
                        </td>
                        <td className="px-3.5 py-2 text-muted-foreground capitalize">
                          {post.mediaType.toLowerCase()}
                        </td>
                        <td className="px-3.5 py-2 text-right font-mono">{post.comments}</td>
                        <td className="px-3.5 py-2 text-right font-mono">{post.dms}</td>
                        <td className="px-3.5 py-2 text-right font-mono">{post.clicks}</td>
                        <td className="px-3.5 py-2 text-right font-mono">{post.conversions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            )}

            {mediaTypes.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {mediaTypes.map((type) => (
                  <span
                    key={type.type}
                    className="rounded-full border border-[#e0e2e8] dark:border-border px-2.5 py-1 text-[10px] font-medium text-muted-foreground"
                  >
                    {type.type.toLowerCase()} · {type.comments} comments · {type.dms} DMs
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
