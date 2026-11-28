import { describe, expect, it } from "vitest";

import {
  summarizePublicReport,
  type PublicReportInput,
} from "@/lib/public-report";

function input(overrides: Partial<PublicReportInput> = {}): PublicReportInput {
  return {
    workspaceName: "Acme",
    days: 30,
    reportKey: "report-token-1",
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
      name: "Guide campaign",
      dms: 2,
      clicks: 1,
      conversions: 1,
      revenueMinor: 49900,
    });
    expect(report.accounts[0]).toMatchObject({
      username: "acme",
      dms: 2,
      deliveryRate: 100,
      conversions: 1,
    });
    expect(report.accounts[1]).toMatchObject({
      dms: 0,
      deliveryRate: 0,
    });
  });

  it("never exposes raw automation or account ids", () => {
    const report = summarizePublicReport(input());
    const rawIds = ["a1", "a2", "acc1", "acc2"];
    const exposed = [
      ...report.campaigns.map((row) => row.id),
      ...report.accounts.map((row) => row.id),
    ];

    for (const id of exposed) {
      expect(rawIds).not.toContain(id);
      expect(id).toMatch(/^[A-Za-z0-9_-]{16}$/);
    }
    expect(new Set(exposed).size).toBe(exposed.length);
  });

  it("derives stable opaque ids for the same token", () => {
    const first = summarizePublicReport(input());
    const second = summarizePublicReport(input());

    expect(second.campaigns.map((row) => row.id)).toEqual(
      first.campaigns.map((row) => row.id)
    );
    expect(second.accounts.map((row) => row.id)).toEqual(
      first.accounts.map((row) => row.id)
    );
  });

  it("derives different opaque ids for a different token", () => {
    const first = summarizePublicReport(input());
    const second = summarizePublicReport(
      input({ reportKey: "report-token-2" })
    );

    expect(second.campaigns.map((row) => row.id)).not.toEqual(
      first.campaigns.map((row) => row.id)
    );
    expect(second.accounts.map((row) => row.id)).not.toEqual(
      first.accounts.map((row) => row.id)
    );
  });

  it("does not include is_verified_manual anywhere in the payload", () => {
    const report = summarizePublicReport(input());
    expect(JSON.stringify(report)).not.toContain("is_verified_manual");
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
