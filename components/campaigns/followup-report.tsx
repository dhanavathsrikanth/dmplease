import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface FollowupReportData {
  steps: Array<{
    step: number;
    delayMinutes: number;
    enabled: boolean;
    holdoutPercent: number;
    sent: number;
    heldOut: number;
    converted: number;
    conversionsFromSent: number;
    conversionsFromHoldout: number;
    revenueFromSent: number;
  }>;
}

export function FollowupReport({ data }: { data: FollowupReportData }) {
  return (
    <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle">
      <CardHeader className="pb-4 border-b border-[#e0e2e8] dark:border-border/60">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base font-semibold tracking-tight">
              Follow-up lift
            </CardTitle>
            <CardDescription className="text-xs mt-0.5 text-[#555a6a] dark:text-muted-foreground">
              A holdout group receives no follow-up. Compare revenue to see whether the extra message earned its place.
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-[10px] font-semibold rounded-full px-3">
            {data.steps.length} step{data.steps.length === 1 ? "" : "s"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-5">
        {data.steps.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No follow-up steps configured for this campaign yet.
          </p>
        ) : (
          <div className="space-y-3">
            {data.steps.map((step) => {
              const lift =
                step.conversionsFromHoldout > 0
                  ? ((step.conversionsFromSent - step.conversionsFromHoldout) /
                      step.conversionsFromHoldout) *
                    100
                  : null;
              return (
                <div
                  key={step.step}
                  className="rounded-xl border border-[#e0e2e8] dark:border-border/80 px-3.5 py-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold">
                      Follow-up #{step.step} · after {step.delayMinutes} min
                    </p>
                    <Badge variant={step.enabled ? "tag-teal" : "outline"} className="text-[10px]">
                      {step.enabled ? "Active" : "Paused"}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
                    <div>
                      <p className="text-muted-foreground">Sent</p>
                      <p className="font-semibold text-sm">{step.sent}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Held out ({step.holdoutPercent}%)</p>
                      <p className="font-semibold text-sm">{step.heldOut}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Conversions</p>
                      <p className="font-semibold text-sm">
                        {step.conversionsFromSent} sent · {step.conversionsFromHoldout} holdout
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Revenue (sent)</p>
                      <p className="font-semibold text-sm">
                        ₹{step.revenueFromSent.toLocaleString("en-IN")}
                      </p>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {lift === null
                      ? step.sent > 0
                        ? "Not enough holdout conversions yet to calculate lift."
                        : "No follow-ups sent yet — the cron sends them when due."
                      : `Observed lift: ${lift > 0 ? "+" : ""}${Math.round(lift)}% versus holdout.`}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
