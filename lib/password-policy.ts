/**
 * Password policy shared by sign-up, password reset and change-password.
 *
 * Keep this in sync with Supabase Dashboard → Authentication → Providers →
 * Email → Password requirements (minimum length 8, lower/upper/digit/symbol).
 * The client check is UX; Supabase Auth is the enforcement layer.
 */

export const PASSWORD_MIN_LENGTH = 8;
/** bcrypt only uses the first 72 bytes, so reject longer inputs explicitly. */
export const PASSWORD_MAX_LENGTH = 72;

export interface PasswordPolicyResult {
  valid: boolean;
  errors: string[];
}

export function validatePassword(password: string): PasswordPolicyResult {
  const errors: string[] = [];

  if (password.length < PASSWORD_MIN_LENGTH) {
    errors.push(`At least ${PASSWORD_MIN_LENGTH} characters`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    errors.push(`At most ${PASSWORD_MAX_LENGTH} characters`);
  }
  if (!/[a-z]/.test(password)) {
    errors.push("One lowercase letter");
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("One uppercase letter");
  }
  if (!/[0-9]/.test(password)) {
    errors.push("One number");
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push("One symbol");
  }

  return { valid: errors.length === 0, errors };
}

export function passwordPolicyHint(): string {
  return `At least ${PASSWORD_MIN_LENGTH} characters with upper and lower case letters, a number and a symbol.`;
}
