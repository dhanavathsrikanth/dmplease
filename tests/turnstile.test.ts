import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadTurnstile,
  resetTurnstileLoader,
} from "@/lib/turnstile-loader";

interface FakeScript {
  id: string;
  src: string;
  async: boolean;
  defer: boolean;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  remove: () => void;
  addEventListener: (type: string, listener: () => void) => void;
}

/**
 * Minimal DOM stand-in. The loader only needs getElementById, createElement and
 * head.appendChild, so a full jsdom environment would be overkill.
 */
function installDom() {
  const scripts: FakeScript[] = [];
  const appended: FakeScript[] = [];

  const documentStub = {
    getElementById: (id: string) =>
      scripts.find((script) => script.id === id) ?? null,
    createElement: () => {
      const script: FakeScript = {
        id: "",
        src: "",
        async: false,
        defer: false,
        onload: null,
        onerror: null,
        remove: () => {
          const index = scripts.indexOf(script);
          if (index >= 0) scripts.splice(index, 1);
        },
        addEventListener: () => {},
      };
      scripts.push(script);
      return script;
    },
    head: {
      appendChild: (script: FakeScript) => {
        appended.push(script);
      },
    },
  };

  vi.stubGlobal("document", documentStub);
  vi.stubGlobal("window", {});

  return { scripts, appended };
}

beforeEach(() => {
  resetTurnstileLoader();
});

afterEach(() => {
  resetTurnstileLoader();
  vi.unstubAllGlobals();
});

describe("loadTurnstile", () => {
  it("retries after a failed script load instead of caching the rejection", async () => {
    const { appended } = installDom();

    const first = loadTurnstile();
    expect(appended).toHaveLength(1);

    appended[0].onerror?.();
    await expect(first).rejects.toThrow("Turnstile failed to load");

    // The failed promise must not be reused: a later mount gets a new script.
    const second = loadTurnstile();
    expect(appended).toHaveLength(2);

    appended[1].onload?.();
    await expect(second).resolves.toBeUndefined();
  });

  it("shares a single in-flight load between concurrent callers", async () => {
    const { appended } = installDom();

    const first = loadTurnstile();
    const second = loadTurnstile();
    expect(appended).toHaveLength(1);

    appended[0].onload?.();
    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ]);
  });

  it("resolves immediately when the Turnstile API is already present", async () => {
    installDom();
    vi.stubGlobal("window", {
      turnstile: { render: vi.fn(), reset: vi.fn(), remove: vi.fn() },
    });

    await expect(loadTurnstile()).resolves.toBeUndefined();
  });

  it("drops a pending load when resetTurnstileLoader is called", async () => {
    const { appended } = installDom();

    const first = loadTurnstile();
    resetTurnstileLoader();

    // With the cache cleared, a later call can resolve from the API directly
    // instead of inheriting the still-pending promise.
    vi.stubGlobal("window", {
      turnstile: { render: vi.fn(), reset: vi.fn(), remove: vi.fn() },
    });
    const second = loadTurnstile();

    expect(appended).toHaveLength(1);
    await expect(second).resolves.toBeUndefined();

    // The abandoned attempt is still pending, which is harmless; resolve it so
    // the test leaves no dangling work.
    appended[0].onload?.();
    await expect(first).resolves.toBeUndefined();
  });
});
