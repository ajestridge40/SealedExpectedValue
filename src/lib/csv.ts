/*
 * CSV helpers. Exported text cells that start with a formula trigger are
 * prefixed with a single quote so spreadsheets do not execute them
 * (CSV/formula injection). Numbers are written as-is.
 */

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export type CsvValue = string | number | boolean | null | undefined;

export function escapeCsvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  let s = value;
  if (FORMULA_TRIGGER.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv<T>(rows: T[], columns: { header: string; value: (row: T) => CsvValue }[]): string {
  const lines = [columns.map((c) => escapeCsvCell(c.header)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => escapeCsvCell(c.value(row))).join(","));
  return lines.join("\r\n") + "\r\n";
}
