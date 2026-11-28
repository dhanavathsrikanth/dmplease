/**
 * Loader for the Cloudflare Turnstile script.
 *
 * Kept outside the React component so the retry behaviour is unit-testable.
 * The promise is cached only while a load is in flight or after it succeeds:
 * a failed load clears the cache so the next mount (or the Retry button) can
 * try again instead of inheriting a permanently rejected promise.
 */

export interface TurnstileApi {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_ID = "cf-turnstile-script";
const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let scriptPromise: Promise<void> | null = null;

/**
 * Drops the cached promise. Used by the Retry button and by tests so a fresh
 * attempt starts from a clean state.
 */
export function resetTurnstileLoader(): void {
  scriptPromise = null;
}

function waitForExistingScript(script: HTMLScriptElement): Promise<void> {
  return new Promise((resolve, reject) => {
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => {
        // Remove the dead tag so a retry creates a fresh one instead of
        // attaching listeners to an element that will never fire again.
        script.remove();
        reject(new Error("Turnstile failed to load"));
      },
      { once: true }
    );
  });
}

export function loadTurnstile(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  const attempt = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(
      SCRIPT_ID
    ) as HTMLScriptElement | null;
    if (existing) {
      waitForExistingScript(existing).then(resolve, reject);
      return;
    }

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      reject(new Error("Turnstile failed to load"));
    };
    document.head.appendChild(script);
  });

  scriptPromise = attempt.catch((error: unknown) => {
    // Never cache a rejection: a transient CDN failure must not disable the
    // widget for the rest of the page session.
    scriptPromise = null;
    throw error;
  });

  return scriptPromise;
}
