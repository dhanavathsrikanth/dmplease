import { randomUUID } from "crypto";
import { after } from "next/server";
import { PostHog } from "posthog-node";

/**
 * Server-side product analytics for events GA4 cannot see: webhook outcomes,
 * OAuth results, cron summaries and dead-letter failures.
 *
 * A client is created per event with flushAt:1 so serverless invocations never
 * lose queued events. `after()` flushes after the response is committed.
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

  try {
    const client = new PostHog(token, { host, flushAt: 1, flushInterval: 0 });
    const anonymous = input.anonymous || !input.distinctId;
    const distinctId = input.distinctId || randomUUID();

    client.capture({
      distinctId,
      event: input.event,
      properties: {
        ...(input.properties ?? {}),
        source: "server",
        ...(anonymous ? { $process_person_profile: false } : {}),
      },
    });

    after(() => {
      void client.shutdown().catch((error: unknown) => {
        console.warn("[posthog] Flush failed:", error);
      });
    });
  } catch (error) {
    // Analytics must never break the request it observes.
    console.warn("[posthog] Capture failed:", error);
  }
}
