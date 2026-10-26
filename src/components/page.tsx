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
        {description ? <p className="text-muted mt-1 max-w-2xl text-sm">{description}</p> : null}
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
        "border-border-strong flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center",
        className,
      )}
    >
      <div className="bg-surface-2 text-accent rounded-full p-3">
        <Icon className="size-6" aria-hidden />
      </div>
      <h2 className="text-base font-semibold">{title}</h2>
      {children ? <div className="text-muted max-w-md text-sm">{children}</div> : null}
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
    <div className={cn("border-border bg-surface rounded-xl border p-4", className)}>
      <div className="text-muted text-xs">{label}</div>
      <div className="tabular mt-1 text-xl font-semibold tracking-tight sm:text-2xl">{value}</div>
      {sub ? <div className="text-muted mt-1 text-xs">{sub}</div> : null}
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
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("rounded-lg border px-3 py-2 text-sm", tones[tone], className)}
    >
      {children}
    </div>
  );
}

export const DISCLAIMER =
  "Prices and pull rates are estimates. EV is a statistical average over many openings, not what any single box will contain; opening sealed product can lose much of its purchase price. Nothing here is financial advice.";
