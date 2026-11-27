/**
 * Pure helpers for the multi-account selection checklist.
 *
 * Keeping filtering and counting here makes the UI predictable and testable:
 * already-connected accounts are never selectable, and the "Create N
 * workspaces" count is always derived from the same rules.
 */

export interface SelectableAccount {
  instagramBusinessId: string;
  username: string;
  displayName?: string | null;
  connected: boolean;
}

export interface SelectionSummary {
  total: number;
  connected: number;
  selectable: number;
  selected: number;
  createCount: number;
}

/** Case-insensitive search over username and display name. */
export function filterSelectableAccounts<T extends SelectableAccount>(
  accounts: T[],
  query: string
): T[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return accounts;
  return accounts.filter((account) =>
    `${account.username} ${account.displayName ?? ""}`
      .toLowerCase()
      .includes(normalized)
  );
}

/** Counts the checklist and the workspaces that would be created. */
export function summarizeSelection(
  accounts: SelectableAccount[],
  selectedIds: Iterable<string>
): SelectionSummary {
  const selected = new Set(selectedIds);
  const connected = accounts.filter((account) => account.connected).length;
  const selectable = accounts.length - connected;
  const selectedSelectable = accounts.filter(
    (account) => !account.connected && selected.has(account.instagramBusinessId)
  ).length;
  return {
    total: accounts.length,
    connected,
    selectable,
    selected: selectedSelectable,
    createCount: selectedSelectable,
  };
}

/** Merges a retry result into the previous results, keyed by account id. */
export function mergeConnectResults<T extends { instagramBusinessId: string }>(
  previous: T[],
  next: T[]
): T[] {
  const merged = new Map(previous.map((result) => [result.instagramBusinessId, result]));
  for (const result of next) {
    merged.set(result.instagramBusinessId, result);
  }
  return [...merged.values()];
}
