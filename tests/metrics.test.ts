import { describe, expect, it } from "vitest";
import { buildMetricKey, parseMetricKey } from "@/lib/metrics";
import { getStartDayUtc } from "@/lib/analytics";
import { mergeDbAndLiveMetrics } from "@/lib/merge-metrics";

describe("metric keys", () => {
  const creatorId = "11111111-1111-4111-8111-111111111111";
  const targetId = "22222222-2222-4222-8222-222222222222";

  it("round-trips a daily key", () => {
    const key = buildMetricKey({
      kind: "dm_sent",
      creatorId,
      targetId,
      day: "2026-11-26",
    });
    expect(key).toBe(`metric:2026-11-26:dm_sent:${creatorId}:${targetId}`);
    expect(parseMetricKey(key)).toMatchObject({
      day: "2026-11-26",
      kind: "dm_sent",
      creatorId,
      targetId,
    });
  });

  it("rejects invalid keys", () => {
    expect(parseMetricKey("garbage")).toBeNull();
    expect(parseMetricKey("metric:2026-11-26:unknown:creator:rule")).toBeNull();
  });

  it("rejects non-UUID creator or target ids", () => {
    expect(
      parseMetricKey("metric:2026-11-26:dm_sent:creator-1:rule-9")
    ).toBeNull();
    expect(
      parseMetricKey(`metric:2026-11-26:dm_sent:${creatorId}:manual`)
    ).toBeNull();
  });

  it("computes an inclusive UTC start day", () => {
    expect(getStartDayUtc(7, "2026-11-26")).toBe("2026-11-20");
    expect(getStartDayUtc(1, "2026-11-26")).toBe("2026-11-26");
  });
});

describe("DB + Redis merge", () => {
  it("adds today's live deltas and recalculates rates", () => {
    const merged = mergeDbAndLiveMetrics({
      dbRows: [
        {
          day: "2026-11-25",
          targetKind: "automation_rule",
          targetId: "rule-1",
          bioClicks: 0,
          dmSent: 10,
          dmLinkClicks: 2,
          dmReplies: 1,
        },
      ],
      liveDeltasToday: {
        "automation_rule:rule-1": {
          bioClicks: 0,
          dmSent: 10,
          dmLinkClicks: 3,
          dmReplies: 2,
        },
      },
      todayDay: "2026-11-26",
      includeTodayLive: true,
    });

    expect(merged.summary.dmSent).toBe(20);
    expect(merged.summary.dmLinkClicks).toBe(5);
    expect(merged.summary.dmCtrPct).toBe(25);
    expect(merged.summary.dmReplyRatePct).toBe(15);
    expect(merged.series).toHaveLength(2);
  });
});
