import { BarChart3, Layers, MessageSquare, ShieldCheck, Ticket, Zap } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { CampaignAnalytics } from "@/lib/campaign-analytics";

interface CampaignAnalyticsCardProps {
  data: CampaignAnalytics;
}

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
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

export function CampaignAnalyticsCard({ data }: CampaignAnalyticsCardProps) {
  const hasVariants = data.variants.length > 1;
  const hasFormats = data.formats.length > 1;
  const hasPublicReplies = data.publicRepliesSent + data.publicRepliesFailed > 0;
  const hasVouchers = data.vouchersGenerated > 0;
  const hasFollowGate = data.followChecks > 0;

  return (
    <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle">
      <CardHeader className="pb-4 border-b border-[#e0e2e8] dark:border-border/60">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base font-semibold tracking-tight flex items-center gap-2">
              <BarChart3 className="size-4 text-[#4262ff]" aria-hidden="true" />
              Campaign performance
            </CardTitle>
            <CardDescription className="text-xs text-[#555a6a] dark:text-muted-foreground">
              Last 30 days. Every figure is query-backed.
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-[10px] font-semibold rounded-full px-3">
            {data.dmSent} DMs sent
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-5 space-y-5">
        {/* Headline tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Tile
            label="DMs sent"
            value={data.dmSent}
            hint={data.dmFailed > 0 ? `${data.dmFailed} failed` : "All delivered"}
          />
          <Tile
            label="Delivery rate"
            value={data.deliveryRate === null ? "—" : `${data.deliveryRate}%`}
            hint={data.dmSent + data.dmFailed > 0 ? `${data.dmSent + data.dmFailed} total` : "No sends yet"}
          />
          <Tile
            label="Link clicks"
            value={data.linkClicks}
            hint={data.uniqueClickers > 0 ? `${data.uniqueClickers} people` : "No clicks yet"}
          />
          <Tile
            label="Conversions"
            value={data.conversions}
            hint={
              data.revenueMinor > 0
                ? `₹${(data.revenueMinor / 100).toLocaleString("en-IN")}`
                : "No revenue yet"
            }
          />
        </div>

        {/* Feature impact — only show cards with data */}
        <div className="space-y-3">
          {hasPublicReplies && (
            <div className="rounded-xl border border-[#e0e2e8] dark:border-border px-3.5 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="size-3.5 text-[#4262ff]" aria-hidden="true" />
                <span className="text-xs font-semibold">Public replies</span>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <span>
                  <strong className="text-foreground">{data.publicRepliesSent}</strong>{" "}
                  <span className="text-muted-foreground">sent</span>
                </span>
                {data.publicRepliesFailed > 0 && (
                  <span className="text-destructive">
                    {data.publicRepliesFailed} failed
                  </span>
                )}
              </div>
            </div>
          )}

          {hasVariants && (
            <div className="rounded-xl border border-[#e0e2e8] dark:border-border px-3.5 py-3 space-y-2">
              <div className="flex items-center gap-2">
                <Zap className="size-3.5 text-[#4262ff]" aria-hidden="true" />
                <span className="text-xs font-semibold">DM variations used</span>
              </div>
              <div className="space-y-1.5">
                {data.variants.map((variant) => {
                  const max = Math.max(...data.variants.map((v) => v.sent), 1);
                  const width = Math.round((variant.sent / max) * 100);
                  return (
                    <div key={variant.label} className="flex items-center gap-2 text-[11px]">
                      <span className="w-20 truncate text-muted-foreground font-mono">
                        {variant.label}
                      </span>
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[#4262ff]"
                          style={{ width: `${width}%` }}
                        />
                      </div>
                      <span className="w-8 text-right font-semibold text-foreground">
                        {variant.sent}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {hasFormats && (
            <div className="rounded-xl border border-[#e0e2e8] dark:border-border px-3.5 py-3 space-y-2">
              <div className="flex items-center gap-2">
                <Layers className="size-3.5 text-[#4262ff]" aria-hidden="true" />
                <span className="text-xs font-semibold">Message formats</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {data.formats.map((format) => (
                  <span
                    key={format.format}
                    className="rounded-full border border-[#e0e2e8] dark:border-border px-2.5 py-1 text-[10px] font-medium"
                  >
                    {format.format} · {format.sent}
                  </span>
                ))}
              </div>
            </div>
          )}

          {hasVouchers && (
            <div className="rounded-xl border border-[#e0e2e8] dark:border-border px-3.5 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Ticket className="size-3.5 text-[#4262ff]" aria-hidden="true" />
                <span className="text-xs font-semibold">Vouchers</span>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <span>
                  <strong className="text-foreground">{data.vouchersGenerated}</strong>{" "}
                  <span className="text-muted-foreground">generated</span>
                </span>
                <span>
                  <strong className="text-foreground">{data.voucherConversions}</strong>{" "}
                  <span className="text-muted-foreground">used in conversions</span>
                </span>
              </div>
            </div>
          )}

          {hasFollowGate && (
            <div className="rounded-xl border border-[#e0e2e8] dark:border-border px-3.5 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-3.5 text-[#4262ff]" aria-hidden="true" />
                <span className="text-xs font-semibold">Ask for Follow</span>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <span>
                  <strong className="text-foreground">{data.followersConfirmed}</strong>{" "}
                  <span className="text-muted-foreground">confirmed of {data.followChecks}</span>
                </span>
                {data.openingMessagesSent > 0 && (
                  <span>
                    <strong className="text-foreground">{data.openingMessagesSent}</strong>{" "}
                    <span className="text-muted-foreground">openers sent</span>
                  </span>
                )}
              </div>
            </div>
          )}

          {data.dmSent === 0 && (
            <p className="text-[11px] text-muted-foreground rounded-xl bg-[#f7f8fa] dark:bg-muted/30 px-3.5 py-2.5">
              No DMs sent yet for this campaign. Analytics appear here once
              someone comments and the DM is delivered.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
