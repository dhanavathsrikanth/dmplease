import { describe, expect, it } from "vitest";

import {
  cancellationReason,
  isFollowupDue,
  nextStepNumber,
  resolveAnchor,
} from "@/lib/followup-policy";

const NOW = Date.parse("2026-11-26T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

describe("follow-up timing policy", () => {
  it("anchors on opt-in when available, not the first DM", () => {
    const anchor = resolveAnchor({
      optedInAt: "2026-11-25T09:00:00.000Z",
      firstDmAt: "2026-11-25T09:00:30.000Z",
    });
    expect(anchor.source).toBe("opt_in");
    expect(anchor.at).toBe("2026-11-25T09:00:00.000Z");
  });

  it("falls back to the first DM for campaigns without a follow gate", () => {
    const anchor = resolveAnchor({
      optedInAt: null,
      firstDmAt: "2026-11-25T09:00:00.000Z",
    });
    expect(anchor.source).toBe("first_dm");
    expect(isFollowupDue(anchor, 1440, NOW)).toBe(true);
  });

  it("ignores a stale opt-in from another campaign", () => {
    const anchor = resolveAnchor({
      optedInAt: "2026-11-20T09:00:00.000Z",
      firstDmAt: "2026-11-25T09:00:00.000Z",
    });
    expect(anchor.source).toBe("first_dm");
    expect(anchor.at).toBe("2026-11-25T09:00:00.000Z");
  });

  it("ignores invalid timestamps", () => {
    expect(resolveAnchor({ optedInAt: "not a date" }).source).toBe("none");
    expect(resolveAnchor({}).source).toBe("none");
    expect(isFollowupDue(resolveAnchor({}), 1440, NOW)).toBe(false);
  });

  it("is not due before the delay has elapsed", () => {
    const anchor = resolveAnchor({ firstDmAt: new Date(NOW - DAY / 2).toISOString() });
    expect(isFollowupDue(anchor, 1440, NOW)).toBe(false);
  });
});

describe("follow-up cancellation policy", () => {
  const anchor = resolveAnchor({ firstDmAt: "2026-11-25T09:00:00.000Z" });

  it("cancels on a click after the anchor", () => {
    expect(
      cancellationReason({ clickedAt: "2026-11-25T10:00:00.000Z" }, anchor)
    ).toBe("click");
  });

  it("cancels on a reply after the anchor", () => {
    expect(
      cancellationReason({ repliedAt: "2026-11-25T12:00:00.000Z" }, anchor)
    ).toBe("reply");
  });

  it("uses the earliest engagement when both happened", () => {
    expect(
      cancellationReason(
        {
          clickedAt: "2026-11-25T15:00:00.000Z",
          repliedAt: "2026-11-25T10:00:00.000Z",
        },
        anchor
      )
    ).toBe("reply");
  });

  it("ignores engagement before the anchor", () => {
    expect(
      cancellationReason(
        {
          clickedAt: "2026-11-24T15:00:00.000Z",
          repliedAt: "2026-11-24T16:00:00.000Z",
        },
        anchor
      )
    ).toBeNull();
  });
});

describe("follow-up step numbering", () => {
  it("fills gaps and suggests the next free step", () => {
    expect(nextStepNumber([1, 3])).toBe(2);
    expect(nextStepNumber([1, 2, 3])).toBe(4);
    expect(nextStepNumber([])).toBe(1);
  });
});
