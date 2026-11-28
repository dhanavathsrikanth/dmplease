import { describe, expect, it } from "vitest";
import {
  ADMIN_ONLY_CHECK_IDS,
  isAdminOnlyCheck,
  visibleChecks,
} from "@/lib/diagnostics/checks";

interface Check {
  id: string;
}

const ALL_CHECKS: Check[] = [
  { id: "database" },
  { id: "meta" },
  { id: "signature" },
  { id: "verify-token" },
  { id: "token-vault" },
  { id: "cron" },
  { id: "delivery" },
];

const MANAGED: Check = { id: "managed-configuration" };

const OPERATIONAL_IDS = ["database", "meta", "delivery"];

describe("diagnostics check visibility", () => {
  it("shows every check to a verified admin", () => {
    const visible = visibleChecks(true, ALL_CHECKS, MANAGED);

    expect(visible.map((check) => check.id)).toEqual(ALL_CHECKS.map((check) => check.id));
    expect(visible.some((check) => check.id === MANAGED.id)).toBe(false);
  });

  it("hides the deployment-configuration checks from non-admins", () => {
    const visible = visibleChecks(false, ALL_CHECKS, MANAGED);
    const ids = visible.map((check) => check.id);

    for (const hidden of ADMIN_ONLY_CHECK_IDS) {
      expect(ids).not.toContain(hidden);
    }
    for (const operational of OPERATIONAL_IDS) {
      expect(ids).toContain(operational);
    }
  });

  it("keeps the operational checks in their original order", () => {
    const visible = visibleChecks(false, ALL_CHECKS, MANAGED);

    expect(visible.map((check) => check.id)).toEqual([
      "database",
      "meta",
      "managed-configuration",
      "delivery",
    ]);
  });

  it("places the generic card where the first hidden check was", () => {
    const visible = visibleChecks(false, ALL_CHECKS, MANAGED);
    const managedIndex = visible.findIndex((check) => check.id === MANAGED.id);
    const firstHiddenIndex = ALL_CHECKS.findIndex((check) => isAdminOnlyCheck(check.id));

    expect(managedIndex).toBe(firstHiddenIndex);
  });

  it("filters without a replacement card when none is supplied", () => {
    const visible = visibleChecks(false, ALL_CHECKS);

    expect(visible.map((check) => check.id)).toEqual(OPERATIONAL_IDS);
  });

  it("appends the generic card when no admin-only check is present", () => {
    const operationalOnly = ALL_CHECKS.filter((check) => !isAdminOnlyCheck(check.id));
    const visible = visibleChecks(false, operationalOnly, MANAGED);

    expect(visible.map((check) => check.id)).toEqual([
      ...OPERATIONAL_IDS,
      "managed-configuration",
    ]);
  });

  it("does not mutate the caller's array", () => {
    const input = [...ALL_CHECKS];
    visibleChecks(false, input, MANAGED);

    expect(input).toEqual(ALL_CHECKS);
  });

  it("classifies exactly the environment-variable checks as admin-only", () => {
    expect([...ADMIN_ONLY_CHECK_IDS]).toEqual([
      "signature",
      "verify-token",
      "token-vault",
      "cron",
    ]);
    for (const id of OPERATIONAL_IDS) {
      expect(isAdminOnlyCheck(id)).toBe(false);
    }
  });
});
