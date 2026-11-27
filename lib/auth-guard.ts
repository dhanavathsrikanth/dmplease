/**
 * Client helper for the app-level auth rate limiter.
 *
 * Supabase Auth has its own built-in rate limits and is the authoritative
 * layer. This guard adds a per-IP Upstash sliding window in front of the
 * forms so repeated attempts are slowed down before they reach Supabase.
 * It fails open: a limiter outage must never block sign-in.
 */

export type AuthGuardAction = "signup" | "login" | "reset" | "magic-link" | "password-change";

export interface AuthGuardResult {
  allowed: boolean;
  error?: string;
}

export async function checkAuthRateLimit(action: AuthGuardAction): Promise<AuthGuardResult> {
  try {
    const response = await fetch("/api/auth/guard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });

    if (response.status === 429) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      return {
        allowed: false,
        error: data.error || "Too many attempts. Please wait a few minutes and try again.",
      };
    }

    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}
