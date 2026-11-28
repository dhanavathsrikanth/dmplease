import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Aceternity-style animated gradient text. The gradient sweeps across the
 * glyphs; the global reduced-motion rule freezes it for users who ask for it.
 */
export function AnimatedGradientText({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "animate-gradient-x bg-[linear-gradient(110deg,hsl(var(--foreground))_0%,hsl(var(--foreground))_35%,hsl(var(--brand))_50%,hsl(var(--foreground))_65%,hsl(var(--foreground))_100%)] bg-[length:200%_100%] bg-clip-text text-transparent motion-reduce:animate-none",
        className
      )}
    >
      {children}
    </span>
  );
}
