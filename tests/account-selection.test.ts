import { describe, expect, it } from "vitest";

import {
  filterSelectableAccounts,
  mergeConnectResults,
  summarizeSelection,
  type SelectableAccount,
} from "@/lib/account-selection";

const accounts: SelectableAccount[] = [
  {
    instagramBusinessId: "ig-1",
    username: "acme",
    displayName: "Acme Studio",
    connected: false,
  },
  {
    instagramBusinessId: "ig-2",
    username: "acme2",
    displayName: "Acme Two",
    connected: true,
  },
  {
    instagramBusinessId: "ig-3",
    username: "other",
    displayName: "Other Brand",
    connected: false,
  },
];

describe("filterSelectableAccounts", () => {
  it("returns all accounts for an empty query", () => {
    expect(filterSelectableAccounts(accounts, "")).toHaveLength(3);
  });

  it("searches username and display name case-insensitively", () => {
    expect(filterSelectableAccounts(accounts, "ACME")).toHaveLength(2);
    expect(filterSelectableAccounts(accounts, "other brand")).toHaveLength(1);
  });

  it("returns nothing when there is no match", () => {
    expect(filterSelectableAccounts(accounts, "missing")).toHaveLength(0);
  });
});

describe("summarizeSelection", () => {
  it("counts connected, selectable and selected accounts", () => {
    const summary = summarizeSelection(accounts, ["ig-1", "ig-3"]);
    expect(summary).toEqual({
      total: 3,
      connected: 1,
      selectable: 2,
      selected: 2,
      createCount: 2,
    });
  });

  it("never counts an already-connected account as creatable", () => {
    const summary = summarizeSelection(accounts, ["ig-2"]);
    expect(summary.selected).toBe(0);
    expect(summary.createCount).toBe(0);
  });

  it("handles an empty selection", () => {
    const summary = summarizeSelection(accounts, []);
    expect(summary.selected).toBe(0);
    expect(summary.createCount).toBe(0);
  });
});

describe("mergeConnectResults", () => {
  it("replaces a failed result with a successful retry", () => {
    const merged = mergeConnectResults(
      [
        { instagramBusinessId: "ig-1", status: "failed" },
        { instagramBusinessId: "ig-2", status: "created" },
      ],
      [{ instagramBusinessId: "ig-1", status: "created" }]
    );
    expect(merged).toHaveLength(2);
    expect(merged.find((row) => row.instagramBusinessId === "ig-1")?.status).toBe(
      "created"
    );
  });
});
