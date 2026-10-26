import type { EvResult } from "@/lib/ev";
import { formatMoney } from "@/lib/money";
import { SourceTypeBadge } from "./badges";
import { Table, Td, Th } from "./ui/table";

function pct(p: { toNumber(): number } | null) {
  if (!p) return "unknown";
  const n = p.toNumber();
  if (n === 0) return "0";
  if (n >= 0.1) return `${(n * 100).toFixed(1)}%`;
  return `${(n * 100).toFixed(2)}% (≈1 in ${Math.round(1 / n).toLocaleString()})`;
}

/** Per-slot, per-outcome table: rates, expected counts, average values and EV contributions. */
export function EvBreakdown({ ev }: { ev: EvResult }) {
  return (
    <div className="flex flex-col gap-6">
      {ev.slots.map((slot) => (
        <section key={slot.id} aria-labelledby={`slot-${slot.id}`}>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h4 id={`slot-${slot.id}`} className="text-sm font-medium">
              {slot.name}{" "}
              <span className="text-muted text-xs font-normal">
                × {slot.occurrences.toString()} per product{slot.kind === "guaranteed" ? " · guaranteed" : ""}
              </span>
            </h4>
            <span className="text-muted text-sm">
              Slot EV <span className="text-fg font-medium">{formatMoney(slot.ev, ev.currency)}</span>
            </span>
          </div>
          <Table>
            <thead>
              <tr>
                <Th>Outcome</Th>
                <Th>Chance per slot</Th>
                <Th>Expected per product</Th>
                <Th>Avg. value</Th>
                <Th>Priced</Th>
                <Th>EV contribution</Th>
                <Th>Source</Th>
              </tr>
            </thead>
            <tbody>
              {slot.outcomes.map((o) => (
                <tr key={o.id}>
                  <Td className="font-medium">{o.label}</Td>
                  <Td>{pct(o.probability)}</Td>
                  <Td>{o.expectedCount ? o.expectedCount.toDecimalPlaces(3).toString() : "—"}</Td>
                  <Td>{o.unitValue ? formatMoney(o.unitValue, ev.currency) : "—"}</Td>
                  <Td className="text-muted">
                    {o.pricedCount}/{o.totalCount}
                    {o.staleCount ? <span className="text-warn"> ({o.staleCount} stale)</span> : null}
                  </Td>
                  <Td>{o.ev ? formatMoney(o.ev, ev.currency) : <span className="text-muted">excluded</span>}</Td>
                  <Td>
                    <div className="flex flex-col gap-1">
                      <SourceTypeBadge type={o.source.type} />
                      {o.source.url ? (
                        <a
                          href={o.source.url}
                          rel="noreferrer nofollow"
                          target="_blank"
                          className="text-accent text-xs hover:underline"
                        >
                          {o.source.name ?? "Source"}
                        </a>
                      ) : o.source.name ? (
                        <span className="text-muted text-xs">{o.source.name}</span>
                      ) : null}
                      {o.source.sampleSize ? (
                        <span className="text-subtle text-xs">n ≈ {o.source.sampleSize.toLocaleString()} packs</span>
                      ) : null}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      ))}
    </div>
  );
}
