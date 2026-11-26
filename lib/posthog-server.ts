import { randomUUID } from "crypto";
import { after } from "next/server";

/**
 * Server-side product analytics for events GA4 cannot see: webhook outcomes,
 * OAuth results, cron summaries and dead-letter failures.
 *
 * We POST directly to PostHog's capture endpoint instead of using the Node
 * SDK's batched queue. In a serverless invocation the SDK can be shut down
 * before its queue drains (we observed "still queued when shutdown ended"
 * in production logs), which silently loses the event. A single awaited
 * fetch inside `after()` has no such race.
 */
export function captureServerEvent(input: {
  event: string;
  properties?: Record<string, unknown>;
  distinctId?: string;
  anonymous?: boolean;
}): void {
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim();
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim();

  if (!token || !host) {
    if (process.env.NODE_ENV !== "production") {
      const missing = !token
        ? "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN"
        : "NEXT_PUBLIC_POSTHOG_HOST";
      console.warn(
        `${missing} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missing} is configured`
      );
    }
    return;
  }

  const anonymous = input.anonymous || !input.distinctId;
  const payload = JSON.stringify({
    api_key: token,
    event: input.event,
    distinct_id: input.distinctId || randomUUID(),
    properties: {
      ...(input.properties ?? {}),
      source: "server",
      ...(anonymous ? { $process_person_profile: false } : {}),
    },
  });
  const endpoint = `${host.replace(/\/$/, "")}/capture/`;

  // `after()` callbacks are awaited by Next.js before the invocation ends.
  after(async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          signal: AbortSignal.timeout(8000),
          cache: "no-store",
        });
        if (response.ok) return;
        console.warn(
          `[posthog] Capture returned ${response.status} for ${input.event}`
        );
      } catch (error) {
        console.warn(`[posthog] Capture attempt ${attempt + 1} failed:`, error);
      }
    }
  });
}
