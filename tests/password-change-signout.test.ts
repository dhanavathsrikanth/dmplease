import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  verifySignIn: vi.fn(),
  clearRecoveryGrant: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: mocks.getUser,
      updateUser: mocks.updateUser,
      signOut: mocks.signOut,
    },
  }),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { signInWithPassword: mocks.verifySignIn },
  }),
}));

vi.mock("@/lib/auth/rate-limit", () => ({
  checkServerAuthRateLimit: mocks.rateLimit,
}));

vi.mock("@/lib/auth/recovery-cookie", () => ({
  clearRecoveryGrant: mocks.clearRecoveryGrant,
}));

import { changePasswordWithCurrentPassword } from "@/app/dashboard/settings/password-actions";

const USER = {
  id: "user-1",
  email: "user@example.com",
  identities: [{ provider: "email" }],
};

const INPUT = {
  currentPassword: "OldPassw0rd!",
  newPassword: "NewPassw0rd!",
  confirmPassword: "NewPassw0rd!",
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");

  mocks.getUser.mockResolvedValue({ data: { user: USER } });
  mocks.verifySignIn.mockResolvedValue({ error: null });
  mocks.updateUser.mockResolvedValue({ error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.clearRecoveryGrant.mockResolvedValue(undefined);
  mocks.rateLimit.mockResolvedValue({ allowed: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("changePasswordWithCurrentPassword", () => {
  it("revokes other sessions after a successful password update", async () => {
    const result = await changePasswordWithCurrentPassword(INPUT);

    expect(result).toEqual({ success: true });
    expect(mocks.updateUser).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "others" });
  });

  it("keeps the current session by using scope 'others'", async () => {
    await changePasswordWithCurrentPassword(INPUT);

    const [options] = mocks.signOut.mock.calls[0];
    expect(options).not.toHaveProperty("scope", "global");
    expect(options).not.toHaveProperty("scope", "local");
  });

  it("does not revoke sessions when the password update fails", async () => {
    mocks.updateUser.mockResolvedValue({
      error: { message: "Password update rejected" },
    });

    const result = await changePasswordWithCurrentPassword(INPUT);

    expect(result.success).toBe(false);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("does not revoke sessions when the current password is wrong", async () => {
    mocks.verifySignIn.mockResolvedValue({
      error: { message: "Invalid login credentials", status: 400 },
    });

    const result = await changePasswordWithCurrentPassword(INPUT);

    expect(result).toEqual({
      success: false,
      error: "Your current password is incorrect.",
    });
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
});
