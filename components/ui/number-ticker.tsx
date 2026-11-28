"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

interface NumberTickerProps {
  value: number;
  startValue?: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  locale?: string;
  className?: string;
}

/**
 * Aceternity-style number ticker.
 *
 * Counts up from `startValue` to `value` the first time the element scrolls
 * into view. Uses `Intl.NumberFormat` so digits and separators follow the
 * active locale, and renders the final value immediately when the user prefers
 * reduced motion.
 */
export function NumberTicker({
  value,
  startValue = 0,
  duration = 900,
  decimals = 0,
  prefix = "",
  suffix = "",
  locale = "en-IN",
  className,
}: NumberTickerProps) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = React.useState(startValue);
  const fromRef = React.useRef(startValue);
  const frameRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    if (reduceMotion) {
      setDisplay(value);
      fromRef.current = value;
      return;
    }

    const animate = () => {
      const from = fromRef.current;
      const delta = value - from;
      if (delta === 0) return;
      const startedAt = performance.now();

      const tick = (now: number) => {
        const progress = Math.min((now - startedAt) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        setDisplay(from + delta * eased);
        if (progress < 1) {
          frameRef.current = requestAnimationFrame(tick);
        } else {
          fromRef.current = value;
        }
      };

      frameRef.current = requestAnimationFrame(tick);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          observer.disconnect();
          animate();
        }
      },
      { threshold: 0.35 }
    );

    observer.observe(el);

    return () => {
      observer.disconnect();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [value, duration]);

  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(display);

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}
