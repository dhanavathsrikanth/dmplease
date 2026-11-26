"use client";

import React from "react";
import { UserCheck, UserX, CloudOff, Activity } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { describeFollowGateReason } from "@/lib/follow-gate-constants";

export interface FollowGateReportData {
  total: number;
  follower: number;
  notFollower: number;
  unavailable: number;
  topReasons: Array<{ reason: string; count: number }>;
}

/** Read-only quality panel for the Ask-for-Follow gate on a campaign. */
export function FollowGateReport({
  data,
  enabled,
}: {
  data: FollowGateReportData;
  enabled: boolean;
}) {
  const confirmed = data.follower + data.notFollower;
  const verificationRate = confirmed > 0 ? Math.round((data.follower / confirmed) * 100) : null;

  return (
    <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 p-5 shadow-subtle space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-sm text-foreground flex items-center gap-2">
            <Activity className="size-4 text-[#4262ff]" aria-hidden="true" />
            Ask for Follow · performance
          </h3>
          <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground mt-0.5">
            Based on the last 500 verification checks for this campaign.
          </p>
        </div>
        <Badge
          variant={enabled ? "tag-teal" : "secondary"}
          className="text-[10px] font-semibold rounded-full px-2.5 w-fit"
        >
          {enabled ? "Gate active" : "Gate off"}
        </Badge>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {[
          {
            label: "Checks",
            value: data.total,
            icon: Activity,
            tone: "text-foreground",
          },
          {
            label: "Confirmed followers",
            value: data.follower,
            icon: UserCheck,
            tone: "text-emerald-600 dark:text-emerald-400",
          },
          {
            label: "Asked to follow",
            value: data.notFollower,
            icon: UserX,
            tone: "text-amber-600 dark:text-amber-400",
          },
          {
            label: "Couldn't verify",
            value: data.unavailable,
            icon: CloudOff,
            tone: "text-rose-600 dark:text-rose-400",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-[#e0e2e8] dark:border-border/60 bg-[#f7f8fa] dark:bg-muted/30 px-3 py-2.5"
          >
            <div className="flex items-center gap-1.5">
              <stat.icon className={`size-3.5 ${stat.tone}`} aria-hidden="true" />
              <p className="text-[10px] text-[#6b6f7e] dark:text-muted-foreground">
                {stat.label}
              </p>
            </div>
            <p className={`text-lg font-semibold mt-1 ${stat.tone}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {verificationRate !== null && (
        <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground">
          <strong className="text-foreground">{verificationRate}%</strong> of people
          Meta could verify were already followers.
        </p>
      )}

      {data.topReasons.length > 0 && (
        <div className="space-y-1.5 border-t border-[#e0e2e8] dark:border-border/60 pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6b6f7e]">
            Why verification was unavailable
          </p>
          {data.topReasons.slice(0, 3).map((item) => (
            <div
              key={item.reason}
              className="flex items-start justify-between gap-3 text-[10px] text-[#555a6a] dark:text-muted-foreground"
            >
              <span>{describeFollowGateReason(item.reason)}</span>
              <span className="font-mono shrink-0">{item.count}</span>
            </div>
          ))}
        </div>
      )}

      {data.total === 0 && (
        <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground rounded-xl bg-[#f7f8fa] dark:bg-muted/30 px-3.5 py-2.5">
          No checks yet. They appear as soon as someone interacts with a gated
          automation.
        </p>
      )}
    </Card>
  );
}
