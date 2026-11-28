import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  authError: null as { message: string } | null,
  workspaces: [{ id: "ws-1" }] as Array<{ id: string }>,
  inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

vi.mock("@/lib/supabase/server", () => {
  function makeBuilder(table: string) {
    const builder: Record<string, unknown> = {};
    const chain = () => builder;

    builder.select = chain;
    builder.update = chain;
    builder.eq = chain;
    builder.limit = chain;
    builder.insert = (values: Record<string, unknown>) => {
      state.inserts.push({ table, values });
      return builder;
    };
    builder.single = () =>
      Promise.resolve({ data: { id: "ws-new" }, error: null });
    builder.then = (
      resolve: (value: unknown) => unknown,
      reject?: (reason: unknown) => unknown
    ) =>
      Promise.resolve(
        table === "workspaces"
          ? { data: state.workspaces, error: null }
          : { data: null, error: null }
      ).then(resolve, reject);

    return builder;
  }

  return {
    createClient: async () => ({
      auth: {
        getUser: async () => ({
          data: { user: state.user },
          error: state.authError,
        }),
      },
      from: (table: string) => makeBuilder(table),
    }),
  };
});

import { submitOnboarding, type OnboardingPayload } from "@/app/onboarding/actions";

const basePayload: OnboardingPayload = {
  fullName: "Ada Lovelace",
  instagramHandle: "@ada",
  niche: "creator",
  primaryGoal: "lead_magnet",
  triggerKeyword: "GUIDE",
  dmMessage: "Hey {username}! Here is your free guide: https://example.com/guide",
  switchingFrom: "none",
  heardFrom: "Instagram",
};

function automationInserts() {
  return state.inserts.filter((insert) => insert.table === "automations");
}

beforeEach(() => {
  state.user = { id: "user-1" };
  state.authError = null;
  state.workspaces = [{ id: "ws-1" }];
  state.inserts = [];
});

describe("submitOnboarding automation screening", () => {
  it("rejects a whitespace-only keyword without inserting an automation", async () => {
    const result = await submitOnboarding({
      ...basePayload,
      triggerKeyword: "   ",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/keyword/i);
    expect(automationInserts()).toHaveLength(0);
  });

  it("inserts a capped ANY_POST automation with the trimmed keyword", async () => {
    const result = await submitOnboarding({
      ...basePayload,
      triggerKeyword: "  guide  ",
    });

    expect(result).toEqual({ success: true });

    const inserts = automationInserts();
    expect(inserts).toHaveLength(1);
    expect(inserts[0].values).toMatchObject({
      workspace_id: "ws-1",
      post_scope: "ANY_POST",
      hourly_cap: 30,
      trigger_keywords: ["guide"],
      dm_message: basePayload.dmMessage,
      active: true,
    });
  });

  it("rejects an unsafe DM message before inserting", async () => {
    const result = await submitOnboarding({
      ...basePayload,
      dmMessage:
        "Links: https://a.example https://b.example https://c.example https://d.example",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/at most 3 links/i);
    expect(automationInserts()).toHaveLength(0);
  });
});
