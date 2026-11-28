import { afterEach, describe, expect, it, vi } from "vitest";
import { getOAuthOrigin } from "@/lib/meta/oauth-origin";

/**
 * Stubs every environment variable the helper reads so a value from the
 * developer's shell or .env file cannot leak into a test.
 */
function stubOriginEnv(values: {
  appUrl?: string;
  siteUrl?: string;
  tunnelUrl?: string;
  cloudflareTunnelUrl?: string;
  nodeEnv?: string;
}) {
  vi.stubEnv("APP_URL", values.appUrl ?? "");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", values.siteUrl ?? "");
  vi.stubEnv("TUNNEL_URL", values.tunnelUrl ?? "");
  vi.stubEnv("CLOUDFLARE_TUNNEL_URL", values.cloudflareTunnelUrl ?? "");
  vi.stubEnv("NODE_ENV", values.nodeEnv ?? "test");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getOAuthOrigin", () => {
  it("prefers APP_URL over NEXT_PUBLIC_SITE_URL", () => {
    stubOriginEnv({
      appUrl: "https://app.example.com",
      siteUrl: "https://site.example.com",
    });

    expect(getOAuthOrigin()).toBe("https://app.example.com");
  });

  it("uses NEXT_PUBLIC_SITE_URL when APP_URL is empty", () => {
    stubOriginEnv({
      appUrl: "",
      siteUrl: "https://site.example.com",
    });

    expect(getOAuthOrigin()).toBe("https://site.example.com");
  });

  it("throws in production when neither origin is configured", () => {
    stubOriginEnv({
      nodeEnv: "production",
      tunnelUrl: "https://tunnel.example.com",
      cloudflareTunnelUrl: "https://cf-tunnel.example.com",
    });

    expect(() => getOAuthOrigin()).toThrow(/APP_URL or NEXT_PUBLIC_SITE_URL/);
  });

  it("falls back to TUNNEL_URL in development", () => {
    stubOriginEnv({
      nodeEnv: "development",
      tunnelUrl: "https://tunnel.example.com",
      cloudflareTunnelUrl: "https://cf-tunnel.example.com",
    });

    expect(getOAuthOrigin()).toBe("https://tunnel.example.com");
  });

  it("falls back to CLOUDFLARE_TUNNEL_URL when TUNNEL_URL is empty", () => {
    stubOriginEnv({
      nodeEnv: "development",
      tunnelUrl: "",
      cloudflareTunnelUrl: "https://cf-tunnel.example.com",
    });

    expect(getOAuthOrigin()).toBe("https://cf-tunnel.example.com");
  });

  it("falls back to localhost in development with no tunnel", () => {
    stubOriginEnv({ nodeEnv: "development" });

    expect(getOAuthOrigin()).toBe("http://localhost:3000");
  });

  it("strips trailing slashes from configured origins", () => {
    stubOriginEnv({ appUrl: "https://app.example.com/" });
    expect(getOAuthOrigin()).toBe("https://app.example.com");

    stubOriginEnv({ appUrl: "", siteUrl: "https://site.example.com/" });
    expect(getOAuthOrigin()).toBe("https://site.example.com");

    stubOriginEnv({
      nodeEnv: "development",
      tunnelUrl: "https://tunnel.example.com/",
    });
    expect(getOAuthOrigin()).toBe("https://tunnel.example.com");
  });
});
