import { describe, expect, it } from "vitest";

import {
  summarizePublicReport,
  type PublicReportInput,
} from "@/lib/public-report";

function input(overrides: Partial<PublicReportInput> = {}): PublicReportInput {
  return {
    workspaceName: "Acme",
    days: 30,
    dms: [
      {
        automation_id: "a1",
        instagram_account_id: "acc1",
        status: "SENT",
        trigger_keyword: "GUIDE",
        keyword: "GUIDE",
        sequence_step: 1,
        sent_at: "2026-11-01T10:00:00.000Z",
      },
      {
        automation_id: "a1",
        instagram_account_id: "acc1",
        status: "SENT",
        trigger_keyword: "GUIDE",
        keyword: "GUIDE",
        sequence_step: 2,
        sent_at: "2026-11-01T11:00:00.000Z",
      },
      {
        automation_id: "a2",
        instagram_account_id: "acc2",
        status: "FAILED",
        trigger_keyword: "VIP",
        keyword: "VIP",
        sequence_step: 1,
        sent_at: "2026-11-02T10:00:00.000Z",
      },
    ],
    clicks: [
      { automation_id: "a1", clicked_at: "2026-11-01T12:00:00.000Z" },
      { automation_id: "a2", clicked_at: "2026-11-02T12:00:00.000Z" },
    ],
    conversions: [
      {
        automation_id: "a1",
        revenue_minor: 49900,
        currency: "INR",
        occurred_at: "2026-11-01T13:00:00.000Z",
      },
    ],
    comments: 10,
    leads: 4,
    automations: [
      { id: "a1", name: "Guide campaign" },
      { id: "a2", name: "VIP campaign" },
    ],
    accounts: [
      { id: "acc1", username: "acme" },
      { id: "acc2", username: "acme2" },
    ],
    ...overrides,
  };
}

describe("summarizePublicReport", () => {
  it("computes headline totals", () => {
    const report = summarizePublicReport(input());
    expect(report.totals).toMatchObject({
      dmsSent: 2,
      dmsFailed: 1,
      deliveryRate: 67,
      optIns: 1,
      linkClicks: 2,
      conversions: 1,
      revenueMinor: 49900,
      currency: "INR",
      comments: 10,
      leads: 4,
    });
  });

  it("builds keyword distribution", () => {
    const report = summarizePublicReport(input());
    expect(report.keywords[0]).toMatchObject({
      keyword: "GUIDE",
      count: 2,
      share: 100,
    });
  });

  it("builds the daily trend", () => {
    const report = summarizePublicReport(input());
    expect(report.trend).toEqual([
      { day: "2026-11-01", dms: 2, clicks: 1 },
      { day: "2026-11-02", dms: 0, clicks: 1 },
    ]);
  });

  it("builds per-campaign and per-account breakdowns", () => {
    const report = summarizePublicReport(input());
    expect(report.campaigns[0]).toMatchObject({
      id: "a1",
      name: "Guide campaign",
      dms: 2,
      clicks: 1,
      conversions: 1,
      revenueMinor: 49900,
    });
    expect(report.accounts[0]).toMatchObject({
      id: "acc1",
      username: "acme",
      dms: 2,
      deliveryRate: 100,
      conversions: 1,
    });
    expect(report.accounts[1]).toMatchObject({
      id: "acc2",
      dms: 0,
      deliveryRate: 0,
    });
  });

  it("handles an empty report", () => {
    const report = summarizePublicReport(
      input({ dms: [], clicks: [], conversions: [], comments: 0, leads: 0 })
    );
    expect(report.totals.dmsSent).toBe(0);
    expect(report.totals.deliveryRate).toBeNull();
    expect(report.keywords).toEqual([]);
    expect(report.trend).toEqual([]);
    expect(report.campaigns).toEqual([]);
    expect(report.accounts).toEqual([]);
  });
});
