import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("bg-surface-3/70 animate-pulse rounded-md", className)} />;
}
