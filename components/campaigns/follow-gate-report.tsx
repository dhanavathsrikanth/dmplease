"use client";

import React, { useState } from "react";
import { UserCheck, UserX, CloudOff, Activity, Search, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { describeFollowGateReason } from "@/lib/follow-gate-constants";

function TestVerification({ workspaceId }: { workspaceId: string }) {
  const [igsid, setIgsid] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const test = async () => {
    if (!igsid.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/instagram/verify-follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          userIgsid: igsid.trim(),
        }),
      });
      const data = (await res.json()) as {
        status?: string;
        explanation?: string;
        username?: string | null;
        error?: string;
      };
      if (!res.ok) {
        setResult(data.error ?? "Verification failed.");
      } else {
        setResult(
          `${data.status ?? "unknown"} — ${data.explanation ?? ""}${
            data.username ? ` (@${data.username})` : ""
          }`
        );
      }
    } catch {
      setResult("Network error.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2 border-t border-[#e0e2e8] dark:border-border/60 pt-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6b6f7e]">
        Test a verification
      </p>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={igsid}
          onChange={(e) => setIgsid(e.target.value)}
          placeholder="Paste a follower's IGSID"
          aria-label="IGSID to test"
          className="flex-1 h-8 rounded-lg border border-[#c7cad5] dark:border-border bg-background px-3 text-xs outline-none focus:border-[#4262ff] focus:ring-2 focus:ring-[#4262ff]/20"
        />
        <button
          type="button"
          onClick={() => void test()}
          disabled={loading || !igsid.trim()}
          className="inline-flex items-center gap-1 rounded-full bg-[#1c1c1e] text-white dark:bg-[#ffd02f] dark:text-[#1c1c1e] px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          ) : (
            <Search className="size-3" aria-hidden="true" />
          )}
          Verify
        </button>
      </div>
      {result && (
        <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground rounded-lg bg-[#f7f8fa] dark:bg-muted/30 px-3 py-2">
          {result}
        </p>
      )}
    </div>
  );
}

export interface FollowGateReportData {
  total: number;
  follower: number;
  notFollower: number;
  unavailable: number;
  topReasons: Array<{ reason: string; count: number }>;
  /** Campaign ID used for the test-verification endpoint. */
  campaignId?: string;
  /** Workspace ID used for the test-verification endpoint. */
  workspaceId?: string;
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

      {enabled && data.workspaceId && (
        <TestVerification workspaceId={data.workspaceId} />
      )}
    </Card>
  );
}
