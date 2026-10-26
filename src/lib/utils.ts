import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function timeAgo(value: string | Date | null | undefined, now = new Date()): string {
  if (!value) return "never";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "unknown";
  const s = Math.round((d.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(s, "second");
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (abs < 86400 * 45) return rtf.format(Math.round(s / 86400), "day");
  return rtf.format(Math.round(s / (86400 * 30)), "month");
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

export function isStale(value: string | Date | null | undefined, staleAfterHours: number, now = new Date()) {
  if (!value) return true;
  const d = value instanceof Date ? value : new Date(value);
  return now.getTime() - d.getTime() > staleAfterHours * 3_600_000;
}

/** Read a single string search param. */
export function param(sp: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() !== "" ? s.trim().slice(0, 200) : undefined;
}
