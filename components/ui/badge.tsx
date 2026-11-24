import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground shadow-xs",
        secondary:
          "border-[#e0e2e8] dark:border-border bg-secondary text-foreground",
        destructive:
          "border-transparent bg-destructive/15 text-destructive border-destructive/20",
        outline: "text-foreground border-[#e0e2e8] dark:border-border",
        yellow:
          "border-transparent bg-[#ffd02f] text-[#1c1c1e] font-semibold",
        "tag-yellow":
          "border-[#ffd02f]/40 bg-[#fff8e0] text-[#746019] dark:bg-[#746019]/30 dark:text-[#ffd02f]",
        "tag-teal":
          "border-[#0fbcb0]/30 bg-[#c3faf5] text-[#187574] dark:bg-[#187574]/30 dark:text-[#c3faf5]",
        "tag-coral":
          "border-[#ff9999]/40 bg-[#ffc6c6] text-[#600000] dark:bg-[#600000]/30 dark:text-[#ffc6c6]",
        "tag-rose":
          "border-[#ffd8f4]/50 bg-[#fde0f0] text-[#7d2663] dark:bg-[#7d2663]/30 dark:text-[#ffd8f4]",
        "tag-purple":
          "border-[#4262ff]/30 bg-[#f5f3ff] text-[#4262ff] dark:bg-[#4262ff]/20 dark:text-[#8b9eff]",
        success:
          "border-transparent bg-[#00b473] text-white font-medium",
        emerald:
          "border-[#0fbcb0]/30 bg-[#c3faf5] text-[#187574] dark:bg-[#187574]/30 dark:text-[#c3faf5] font-medium",
        night:
          "border-[#2c2c34] bg-[#1c1c1e] text-neutral-300 font-mono text-[11px]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
