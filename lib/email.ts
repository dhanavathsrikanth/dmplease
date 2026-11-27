/**
 * Minimal Resend email helper shared by cron jobs and alerting.
 * Returns a status so callers can record delivery without throwing.
 */

export interface EmailResult {
  status: "sent" | "failed" | "not_configured";
  error?: string;
}

export async function sendEmail(input: {
  to: string[];
  subject: string;
  text: string;
  from?: string;
}): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = input.from || process.env.ALERT_FROM_EMAIL?.trim();
  const to = input.to.map((email) => email.trim()).filter(Boolean);
  if (!key || !from || to.length === 0) {
    return {
      status: "not_configured",
      error: "RESEND_API_KEY, ALERT_FROM_EMAIL or recipient list is missing",
    };
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject: input.subject, text: input.text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return {
        status: "failed",
        error: `Resend returned ${response.status}: ${(await response.text()).slice(0, 300)}`,
      };
    }
    return { status: "sent" };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "Email request failed",
    };
  }
}
