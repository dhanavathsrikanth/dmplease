"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { loadTurnstile, resetTurnstileLoader } from "@/lib/turnstile-loader";

/**
 * Cloudflare Turnstile widget for Supabase Auth CAPTCHA.
 *
 * Supabase verifies the token server-side. Configure the matching secret in
 * Supabase Dashboard → Authentication → Attack Protection → CAPTCHA, and set
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY in the deployment environment.
 *
 * If the site key is absent the widget renders nothing and no token is sent.
 * Supabase Auth CAPTCHA must be disabled in that environment, otherwise every
 * auth request is rejected for a missing token.
 */

export function Turnstile({
  onToken,
  resetKey = 0,
  action,
}: {
  onToken: (token: string | null) => void;
  resetKey?: number;
  action?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    if (!siteKey || !containerRef.current) return;
    let cancelled = false;
    setFailed(false);

    loadTurnstile()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        try {
          widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: siteKey,
            action,
            theme: "auto",
            callback: (token: string) => onTokenRef.current(token),
            "expired-callback": () => onTokenRef.current(null),
            "error-callback": () => {
              // The widget could not produce a token (bad site key, blocked
              // request, challenge failure). Surface the retry affordance
              // instead of leaving the form silently unsubmittable.
              onTokenRef.current(null);
              setFailed(true);
            },
          });
        } catch {
          // A render failure (bad site key, blocked script) is as fatal as a
          // load failure: surface it and make sure no stale token is submitted.
          setFailed(true);
          onTokenRef.current(null);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        onTokenRef.current(null);
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, action, attempt]);

  useEffect(() => {
    if (resetKey > 0 && widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
      onTokenRef.current(null);
    }
  }, [resetKey]);

  const retry = useCallback(() => {
    resetTurnstileLoader();
    onTokenRef.current(null);
    setFailed(false);
    setAttempt((value) => value + 1);
  }, []);

  if (!siteKey) {
    // No site key: render nothing and send no captchaToken. Supabase Auth
    // CAPTCHA must be disabled for this environment, otherwise every auth
    // request is rejected for a missing token.
    return null;
  }

  if (failed) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive"
      >
        <span>CAPTCHA failed to load.</span>
        <button
          type="button"
          onClick={retry}
          className="font-semibold underline underline-offset-2"
        >
          Retry
        </button>
      </div>
    );
  }

  return <div ref={containerRef} className="flex justify-center" />;
}
