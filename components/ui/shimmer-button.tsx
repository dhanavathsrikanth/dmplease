"use client";

import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

interface ShimmerButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  href?: string;
  target?: string;
  rel?: string;
}

const base =
  "group/shimmer relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-xs transition-[background-color,box-shadow,transform] duration-200 hover:bg-primary/90 hover:shadow-card active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";

/**
 * Aceternity-style shimmer button. Renders a Next.js link when `href` is set
 * so navigation keeps native anchor semantics (Cmd/Ctrl-click, middle-click).
 */
export function ShimmerButton({
  className,
  children,
  href,
  target,
  rel,
  ...props
}: ShimmerButtonProps) {
  const content = (
    <>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 ease-out group-hover/shimmer:translate-x-full motion-reduce:hidden"
      />
      <span className="relative inline-flex items-center gap-2">{children}</span>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        target={target}
        rel={rel}
        className={cn(base, className)}
      >
        {content}
      </Link>
    );
  }

  return (
    <button type="button" className={cn(base, className)} {...props}>
      {content}
    </button>
  );
}
