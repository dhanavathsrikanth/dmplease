import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recoverStuckItems } from "@/lib/rerun-runner";

interface Row {
  id: string;
  attempts: number;
}

function makeDb(rows: { claimed: Row[]; legacy: Row[] }) {
  const updates: Array<{ payload: Record<string, unknown>; id: string }> = [];

  const db = {
    from: () => {
      let mode: "claimed" | "legacy" = "claimed";
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        lt: (column: string) => {
          mode = column === "claimed_at" ? "claimed" : "legacy";
          return builder;
        },
        is: () => {
          mode = "legacy";
          return builder;
        },
        limit: () =>
          Promise.resolve({
            data: mode === "claimed" ? rows.claimed : rows.legacy,
            error: null,
          }),
        update: (payload: Record<string, unknown>) => ({
          eq: (_column: string, id: string) => {
            updates.push({ payload, id });
            return { eq: () => Promise.resolve({ error: null }) };
          },
        }),
      };
      return builder;
    },
  } as unknown as SupabaseClient;

  return { db, updates };
}

describe("recoverStuckItems", () => {
  it("resets an abandoned claim to pending and clears claimed_at", async () => {
    const { db, updates } = makeDb({
      claimed: [{ id: "item-1", attempts: 1 }],
      legacy: [],
    });

    await recoverStuckItems(db, "job-1");

    expect(updates).toEqual([
      { id: "item-1", payload: { status: "pending", claimed_at: null } },
    ]);
  });

  it("fails an item that has exhausted its attempts", async () => {
    const { db, updates } = makeDb({
      claimed: [{ id: "item-2", attempts: 3 }],
      legacy: [],
    });

    await recoverStuckItems(db, "job-1");

    expect(updates[0].payload).toMatchObject({
      status: "failed",
      claimed_at: null,
    });
  });

  it("recovers a legacy row that has no claimed_at", async () => {
    const { db, updates } = makeDb({
      claimed: [],
      legacy: [{ id: "item-3", attempts: 1 }],
    });

    await recoverStuckItems(db, "job-1");

    expect(updates).toEqual([
      { id: "item-3", payload: { status: "pending", claimed_at: null } },
    ]);
  });
});
