import { describe, expect, it } from "vitest";

import { hashString, selectTargetIndex } from "@/lib/link-rotation";

const targets = [
  { id: "a", enabled: true, position: 0 },
  { id: "b", enabled: true, position: 1 },
  { id: "c", enabled: true, position: 2 },
];

describe("link rotation", () => {
  it("is stable for the same recipient in sticky mode", () => {
    const first = selectTargetIndex({
      targets,
      mode: "sticky",
      scopeKey: "rotator-1",
      recipientId: "follower-1",
    });
    expect(
      selectTargetIndex({
        targets,
        mode: "sticky",
        scopeKey: "rotator-1",
        recipientId: "follower-1",
      })
    ).toBe(first);
  });

  it("spreads different recipients across destinations", () => {
    const picked = new Set(
      Array.from({ length: 60 }, (_, index) =>
        selectTargetIndex({
          targets,
          mode: "sticky",
          scopeKey: "rotator-1",
          recipientId: `follower-${index}`,
        })
      )
    );
    expect(picked.size).toBe(3);
  });

  it("rotates evenly in round-robin mode", () => {
    const picks = [0, 1, 2, 3, 4].map(
      (counter) =>
        selectTargetIndex({
          targets,
          mode: "round_robin",
          scopeKey: "rotator-1",
          recipientId: "anyone",
          counter,
        })
    );
    expect(picks).toEqual([0, 1, 2, 0, 1]);
  });

  it("skips disabled destinations", () => {
    const index = selectTargetIndex({
      targets: [
        { id: "a", enabled: false, position: 0 },
        { id: "b", enabled: true, position: 1 },
      ],
      mode: "sticky",
      scopeKey: "rotator-1",
      recipientId: "follower-1",
    });
    expect(index).toBe(0);
  });

  it("returns -1 when nothing is enabled", () => {
    expect(
      selectTargetIndex({
        targets: [{ id: "a", enabled: false }],
        mode: "sticky",
        scopeKey: "r",
        recipientId: "f",
      })
    ).toBe(-1);
  });

  it("hashes deterministically", () => {
    expect(hashString("abc")).toBe(hashString("abc"));
    expect(hashString("abc")).not.toBe(hashString("abd"));
  });
});
