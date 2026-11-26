import { PostHog } from "posthog-node";

let posthogServer: PostHog | null = null;

export function getPostHogErrorServer(): PostHog | null {
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim();
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim();

  if (!token || !host) {
    return null;
  }

  posthogServer ??= new PostHog(token, {
    host,
    flushAt: 1,
    flushInterval: 0,
    enableExceptionAutocapture: process.env.NEXT_RUNTIME === "nodejs",
  });

  return posthogServer;
}
