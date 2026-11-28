import * as React from "react";

import { cn } from "@/lib/utils";

/** Aceternity-style bento grid primitives. */
export function BentoGrid({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("grid grid-cols-1 gap-4 md:grid-cols-3", className)}>
      {children}
    </div>
  );
}

export function BentoGridItem({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-subtle",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
