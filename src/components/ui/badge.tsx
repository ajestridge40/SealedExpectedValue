import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap [&_svg]:size-3",
  {
    variants: {
      tone: {
        neutral: "border-border-strong bg-surface-2 text-muted",
        accent: "border-accent/30 bg-accent-soft text-accent",
        gain: "border-gain/30 bg-gain-soft text-gain",
        loss: "border-loss/30 bg-loss-soft text-loss",
        warn: "border-warn/30 bg-warn-soft text-warn",
        info: "border-info/30 bg-info-soft text-info",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({ className, tone, ...props }: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
