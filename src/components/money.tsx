import { type DecimalInput, decOrNull, formatMoney, formatPercent } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Money amount; with `signed`, gains are green and losses red (with a +/− sign, not color alone). */
export function Money({
  value,
  currency = "USD",
  signed,
  className,
}: {
  value: DecimalInput | null | undefined;
  currency?: string;
  signed?: boolean;
  className?: string;
}) {
  const d = decOrNull(value ?? null);
  const tone = signed && d ? (d.gt(0) ? "text-gain" : d.lt(0) ? "text-loss" : "text-muted") : undefined;
  return <span className={cn("tabular", tone, className)}>{formatMoney(d, currency, { signed })}</span>;
}

export function Percent({
  value,
  signed = true,
  className,
}: {
  value: DecimalInput | null | undefined;
  signed?: boolean;
  className?: string;
}) {
  const d = decOrNull(value ?? null);
  const tone = signed && d ? (d.gt(0) ? "text-gain" : d.lt(0) ? "text-loss" : "text-muted") : undefined;
  return <span className={cn("tabular", tone, className)}>{formatPercent(d, { signed })}</span>;
}
