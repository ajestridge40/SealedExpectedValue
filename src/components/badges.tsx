import { AlertTriangle, BadgeCheck, Clock, FileSpreadsheet, PencilLine, Radio, Users, HelpCircle } from "lucide-react";
import type { ConfidenceLevel, EvResult, PullRateSourceType } from "@/lib/ev";
import type { PriceKind } from "@/lib/data/types";
import { formatDateTime, isStale, timeAgo } from "@/lib/utils";
import { Badge } from "./ui/badge";

const CONFIDENCE: Record<ConfidenceLevel, { label: string; tone: "gain" | "info" | "warn" | "neutral" }> = {
  high: { label: "High confidence", tone: "gain" },
  medium: { label: "Medium confidence", tone: "info" },
  low: { label: "Low confidence", tone: "warn" },
  insufficient: { label: "Insufficient data", tone: "neutral" },
};

export function ConfidenceBadge({ level, short }: { level: ConfidenceLevel; short?: boolean }) {
  const c = CONFIDENCE[level];
  return (
    <Badge tone={c.tone} title={`${c.label}. See Methodology for how this is assigned.`}>
      {short ? c.label.replace(" confidence", "") : c.label}
    </Badge>
  );
}

export function EvStatusBadge({ status }: { status: EvResult["status"] | "no_model" }) {
  if (status === "complete") return null;
  if (status === "partial")
    return (
      <Badge tone="warn" title="Some outcomes lack a pull rate or price; the EV covers only what is known.">
        <AlertTriangle /> Partial estimate
      </Badge>
    );
  if (status === "no_model")
    return (
      <Badge tone="neutral" title="No pull-rate model has been entered for this product.">
        <HelpCircle /> No pull-rate model
      </Badge>
    );
  return (
    <Badge tone="neutral" title="Not enough pull-rate or price data to estimate EV.">
      <HelpCircle /> Insufficient pull-rate data
    </Badge>
  );
}

const KIND: Record<PriceKind, { label: string; icon: typeof Radio }> = {
  provider: { label: "Provider", icon: Radio },
  csv_import: { label: "CSV import", icon: FileSpreadsheet },
  manual: { label: "Manual", icon: PencilLine },
};

export function PriceKindBadge({ kind, sourceName }: { kind: PriceKind | null; sourceName?: string | null }) {
  if (!kind) return null;
  const k = KIND[kind];
  const Icon = k.icon;
  return (
    <Badge tone="neutral" title={sourceName ?? k.label}>
      <Icon /> {kind === "provider" && sourceName ? sourceName.split(" (")[0] : k.label}
    </Badge>
  );
}

/** "Updated 3 hours ago", amber when stale, explicit when missing. */
export function FreshnessBadge({ asOf, staleAfterHours = 72 }: { asOf: string | null; staleAfterHours?: number }) {
  if (!asOf)
    return (
      <Badge tone="neutral">
        <Clock /> No price yet
      </Badge>
    );
  const stale = isStale(asOf, staleAfterHours);
  return (
    <Badge tone={stale ? "warn" : "neutral"} title={`Price as of ${formatDateTime(asOf)}`}>
      <Clock /> {stale ? "Stale · " : ""}
      {timeAgo(asOf)}
    </Badge>
  );
}

const SOURCE: Record<PullRateSourceType, { label: string; tone: "gain" | "info" | "warn" | "neutral"; icon: typeof Users }> = {
  official: { label: "Official", tone: "gain", icon: BadgeCheck },
  community: { label: "Community estimate", tone: "info", icon: Users },
  user_assumption: { label: "Assumption", tone: "warn", icon: PencilLine },
  unknown: { label: "Unknown", tone: "neutral", icon: HelpCircle },
};

export function SourceTypeBadge({ type }: { type: PullRateSourceType }) {
  const s = SOURCE[type];
  const Icon = s.icon;
  return (
    <Badge tone={s.tone}>
      <Icon /> {s.label}
    </Badge>
  );
}
