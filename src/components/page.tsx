import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border-strong px-6 py-12 text-center",
        className,
      )}
    >
      <div className="rounded-full bg-surface-2 p-3 text-accent">
        <Icon className="size-6" aria-hidden />
      </div>
      <h2 className="text-base font-semibold">{title}</h2>
      {children ? <div className="max-w-md text-sm text-muted">{children}</div> : null}
      {action}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-border bg-surface p-4", className)}>
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold tracking-tight tabular sm:text-2xl">{value}</div>
      {sub ? <div className="mt-1 text-xs text-muted">{sub}</div> : null}
    </div>
  );
}

export function Notice({
  tone = "info",
  children,
  className,
}: {
  tone?: "info" | "warn" | "error" | "success";
  children: React.ReactNode;
  className?: string;
}) {
  const tones = {
    info: "border-info/30 bg-info-soft text-fg",
    warn: "border-warn/30 bg-warn-soft text-fg",
    error: "border-loss/40 bg-loss-soft text-fg",
    success: "border-gain/30 bg-gain-soft text-fg",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("rounded-lg border px-3 py-2 text-sm", tones[tone], className)}>
      {children}
    </div>
  );
}

export const DISCLAIMER =
  "Prices and pull rates are estimates. EV is a statistical average over many openings, not what any single box will contain; opening sealed product can lose much of its purchase price. Nothing here is financial advice.";
