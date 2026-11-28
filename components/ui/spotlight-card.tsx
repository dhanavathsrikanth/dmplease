"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

interface SpotlightCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Any CSS color. Defaults to the brand yellow at low alpha. */
  spotlightColor?: string;
  /** Radius of the spotlight in pixels. */
  spotlightSize?: number;
}

/**
 * Aceternity-style spotlight card.
 *
 * Tracks the pointer with CSS custom properties (no React re-render per move)
 * and paints a soft radial highlight. Falls back to a static card when the
 * pointer never enters, and the global reduced-motion rule disables the
 * transition for users who ask for it.
 */
export function SpotlightCard({
  className,
  children,
  spotlightColor = "hsl(var(--brand) / 0.16)",
  spotlightSize = 320,
  ...props
}: SpotlightCardProps) {
  const ref = React.useRef<HTMLDivElement>(null);

  const handlePointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      el.style.setProperty("--spotlight-x", `${event.clientX - rect.left}px`);
      el.style.setProperty("--spotlight-y", `${event.clientY - rect.top}px`);
    },
    []
  );

  return (
    <div
      ref={ref}
      onPointerMove={handlePointerMove}
      onPointerEnter={(event) => {
        ref.current?.style.setProperty("--spotlight-opacity", "1");
        handlePointerMove(event);
      }}
      onPointerLeave={() => {
        ref.current?.style.setProperty("--spotlight-opacity", "0");
      }}
      className={cn(
        "group/spotlight relative overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-subtle",
        "transition-[border-color,box-shadow,transform] duration-200 ease-out",
        "hover:-translate-y-0.5 hover:border-border-strong hover:shadow-card",
        "focus-within:border-border-strong focus-within:shadow-card",
        className
      )}
      style={
        {
          "--spotlight-opacity": "0",
          "--spotlight-size": `${spotlightSize}px`,
        } as React.CSSProperties
      }
      {...props}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[var(--spotlight-opacity)] transition-opacity duration-300"
        style={{
          background: `radial-gradient(var(--spotlight-size) circle at var(--spotlight-x, 50%) var(--spotlight-y, 50%), ${spotlightColor}, transparent 70%)`,
        }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}
