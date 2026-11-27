import { describe, expect, it } from "vitest";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordPolicyHint,
  validatePassword,
} from "@/lib/password-policy";

describe("password policy", () => {
  it("accepts a password that meets every requirement", () => {
    expect(validatePassword("Str0ng!Pass").valid).toBe(true);
  });

  it("rejects passwords shorter than the minimum", () => {
    const result = validatePassword("Aa1!aaa");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(`At least ${PASSWORD_MIN_LENGTH} characters`);
  });

  it("rejects passwords longer than the bcrypt limit", () => {
    const result = validatePassword(`Aa1!${"a".repeat(PASSWORD_MAX_LENGTH)}`);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(`At most ${PASSWORD_MAX_LENGTH} characters`);
  });

  it("requires lower case, upper case, a number and a symbol", () => {
    expect(validatePassword("alllowercase1!").errors).toContain("One uppercase letter");
    expect(validatePassword("ALLUPPERCASE1!").errors).toContain("One lowercase letter");
    expect(validatePassword("NoNumbers!!").errors).toContain("One number");
    expect(validatePassword("NoSymbols123").errors).toContain("One symbol");
  });

  it("returns every missing requirement at once", () => {
    const result = validatePassword("short");
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });

  it("describes the policy for the UI", () => {
    expect(passwordPolicyHint()).toContain(String(PASSWORD_MIN_LENGTH));
    expect(passwordPolicyHint()).toContain("symbol");
  });
});
