"use client";

import React from "react";
import { UserPlus, MousePointerClick, TrendingUp, PackageCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { FollowPromptStats } from "@/lib/follow-analytics";

/** Inbox card: follower growth attributed to in-chat follow prompts. */
export function FollowGrowthCard({ stats }: { stats: FollowPromptStats }) {
  const maxDaily = Math.max(1, ...stats.series.map((point) => point.newFollowers));

  return (
    <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 p-5 shadow-subtle space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <UserPlus className="size-4 text-[#4262ff]" aria-hidden="true" />
            Follower growth from in-chat prompts
          </h2>
          <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground mt-0.5">
            Last 7 days · only verified new follows are counted as growth.
          </p>
        </div>
        <Badge variant="outline" className="text-[10px] font-medium rounded-full w-fit">
          Hard gate on
        </Badge>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {[
          {
            label: "New followers",
            value: stats.newFollowers,
            icon: TrendingUp,
            tone: "text-emerald-600 dark:text-emerald-400",
          },
          {
            label: "Prompts sent",
            value: stats.sent,
            icon: UserPlus,
            tone: "text-foreground",
          },
          {
            label: "Tap rate",
            value: stats.tapRate === null ? "—" : `${stats.tapRate}%`,
            icon: MousePointerClick,
            tone: "text-[#4262ff]",
          },
          {
            label: "Content delivered",
            value: stats.delivered,
            icon: PackageCheck,
            tone: "text-foreground",
          },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-xl border border-[#e0e2e8] dark:border-border/60 bg-[#f7f8fa] dark:bg-muted/30 px-3 py-2.5"
          >
            <div className="flex items-center gap-1.5">
              <item.icon className={`size-3.5 ${item.tone}`} aria-hidden="true" />
              <p className="text-[10px] text-[#6b6f7e] dark:text-muted-foreground">
                {item.label}
              </p>
            </div>
            <p className={`text-lg font-semibold mt-1 ${item.tone}`}>{item.value}</p>
          </div>
        ))}
      </div>

      {stats.series.length > 0 ? (
        <div className="space-y-2 border-t border-[#e0e2e8] dark:border-border/60 pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6b6f7e]">
            Verified new follows per day
          </p>
          <div className="flex items-end gap-2 h-16" role="img" aria-label="Daily verified new follows">
            {stats.series.map((point) => (
              <div key={point.day} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full rounded-t-md bg-gradient-to-t from-[#4262ff]/40 to-[#4262ff] min-h-[3px]"
                  style={{
                    height: `${Math.max(3, (point.newFollowers / maxDaily) * 48)}px`,
                  }}
                  title={`${point.day}: ${point.newFollowers} new follower(s)`}
                />
                <span className="text-[9px] text-[#8e93a3]">{point.day.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground rounded-xl bg-[#f7f8fa] dark:bg-muted/30 px-3.5 py-2.5">
          Send a follow prompt from any conversation to start tracking growth.
        </p>
      )}

      <p className="text-[10px] text-[#6b6f7e] dark:text-muted-foreground">
        {stats.alreadyFollowing} already followed · {stats.notFollowers} not yet following ·{" "}
        {stats.unavailable} unverified · {stats.expired} expired
      </p>
    </Card>
  );
}
