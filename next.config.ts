import { withPostHogConfig } from "@posthog/nextjs-config";
import type { NextConfig } from "next";

const sourceMapUploadEnabled = Boolean(
  process.env.POSTHOG_API_KEY && process.env.POSTHOG_PROJECT_ID,
);

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  allowedDevOrigins: [
    "*.ngrok-free.app",
    "**.ngrok-free.app",
    "*.ngrok.app",
    "*.trycloudflare.com",
    "localhost",
    "127.0.0.1",
  ],
};

export default withPostHogConfig(nextConfig, {
  personalApiKey: process.env.POSTHOG_API_KEY ?? "",
  projectId: process.env.POSTHOG_PROJECT_ID,
  host: process.env.POSTHOG_HOST,
  sourcemaps: {
    enabled: sourceMapUploadEnabled,
    deleteAfterUpload: true,
  },
});
