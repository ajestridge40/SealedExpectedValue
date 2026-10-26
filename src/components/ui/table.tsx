import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("tabular w-full text-sm", className)} {...props} />
    </div>
  );
}
export function Th({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "border-border text-muted border-b px-3 py-2 text-left text-xs font-medium whitespace-nowrap",
        className,
      )}
      {...props}
    />
  );
}
export function Td({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("border-border/60 border-b px-3 py-2.5 align-middle", className)} {...props} />;
}
