import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground font-medium shadow-xs hover:bg-[#2c2c34] hover:shadow-sm dark:bg-white dark:text-[#1c1c1e] dark:hover:bg-neutral-200",
        yellow:
          "bg-[#ffd02f] hover:bg-[#fcb900] text-[#1c1c1e] font-medium shadow-xs hover:shadow-sm",
        blue:
          "bg-[#4262ff] hover:bg-[#2a41b6] text-white font-medium shadow-xs hover:shadow-sm",
        destructive:
          "bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90",
        outline:
          "border border-[#c7cad5] dark:border-border bg-background text-foreground shadow-xs hover:bg-secondary hover:border-[#8e91a0]",
        secondary:
          "bg-secondary text-secondary-foreground shadow-xs hover:bg-[#eef0f3] dark:hover:bg-muted/80",
        ghost: "hover:bg-secondary hover:text-foreground rounded-lg",
        link: "text-[#4262ff] underline-offset-4 hover:underline",
        supabase:
          "bg-[#ffd02f] text-[#1c1c1e] font-medium shadow-xs hover:bg-[#fcb900]",
        night:
          "bg-[#1c1c1e] text-white border border-[#2c2c34] shadow-xs hover:bg-[#2c2c34]",
      },
      size: {
        default: "h-9 px-5 py-2",
        sm: "h-8 rounded-full px-3.5 text-xs",
        lg: "h-11 rounded-full px-7 text-sm font-medium",
        icon: "h-9 w-9 rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
