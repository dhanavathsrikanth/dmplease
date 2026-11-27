import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { shortLinkPreview } from "@/lib/link-preview";

export interface LinkPerformanceRow {
  shortCode: string;
  destination: string;
  label: string | null;
  clicks: number;
  uniqueClickers: number;
  lastClickedAt: string | null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function LinkPerformance({ rows }: { rows: LinkPerformanceRow[] }) {
  const total = rows.reduce((sum, row) => sum + row.clicks, 0);
  return (
    <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle">
      <CardHeader className="pb-4 border-b border-[#e0e2e8] dark:border-border/60">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base font-semibold tracking-tight">
              Smart link performance
            </CardTitle>
            <CardDescription className="text-xs mt-0.5 text-[#555a6a] dark:text-muted-foreground">
              Every short link sent by this campaign, with real human clicks only.
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-[10px] font-semibold rounded-full px-3">
            {total} click{total === 1 ? "" : "s"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-5">
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No smart links sent yet. Turn on Smart tracked links and publish the campaign to
            start seeing click data here.
          </p>
        ) : (
          <div className="space-y-2.5">
            {rows.map((row) => (
              <div
                key={row.shortCode}
                className="rounded-xl border border-[#e0e2e8] dark:border-border px-3.5 py-3 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="text-xs font-semibold font-mono">
                    {shortLinkPreview().split("/")[0]}/{row.shortCode}
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate max-w-xs">
                    {row.label ?? hostOf(row.destination)}
                  </p>
                </div>
                <div className="flex items-center gap-5 text-xs">
                  <div className="text-center">
                    <p className="font-bold text-foreground">{row.clicks}</p>
                    <p className="text-[10px] text-muted-foreground">Clicks</p>
                  </div>
                  <div className="text-center">
                    <p className="font-bold text-foreground">{row.uniqueClickers}</p>
                    <p className="text-[10px] text-muted-foreground">People</p>
                  </div>
                  <div className="text-center">
                    <p className="font-bold text-foreground">
                      {row.lastClickedAt
                        ? new Date(row.lastClickedAt).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                          })
                        : "—"}
                    </p>
                    <p className="text-[10px] text-muted-foreground">Last click</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
