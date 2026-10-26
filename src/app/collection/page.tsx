import { AlertTriangle, Download, LayoutGrid, Library, Pencil, Plus, Rows3 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { deleteLot } from "@/app/actions/collection";
import { PriceKindBadge } from "@/components/badges";
import { CatalogImage } from "@/components/catalog-image";
import { ConfirmDelete } from "@/components/confirm-delete";
import { Money, Percent } from "@/components/money";
import { EmptyState, Notice, PageHeader, Stat } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Table, Td, Th } from "@/components/ui/table";
import { getCollection, type CollectionEntry } from "@/lib/data/collection";
import { groupPositions, type PositionSummary, type PriceStatus } from "@/lib/portfolio/valuation";
import { cn, formatDate, param } from "@/lib/utils";

export const metadata: Metadata = { title: "My collection" };

const STATUS: Record<PriceStatus, { label: string; tone: "neutral" | "warn" | "info" | "gain" }> = {
  fresh: { label: "Current", tone: "neutral" },
  stale: { label: "Stale price", tone: "warn" },
  manual: { label: "Manual value", tone: "info" },
  missing: { label: "No price", tone: "warn" },
  currency_mismatch: { label: "Other currency", tone: "warn" },
};

function StatusBadge({ s }: { s: PriceStatus }) {
  return s === "fresh" ? null : <Badge tone={STATUS[s].tone}>{STATUS[s].label}</Badge>;
}

type Sort = "value" | "gain" | "gain_pct" | "name" | "added";

export default async function CollectionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { entries, totals, currency } = await getCollection();
  const type = param(sp, "type");
  const q = param(sp, "q")?.toLowerCase();
  const view = param(sp, "view") === "grid" ? "grid" : "table";
  const status = param(sp, "status");
  const sort = (["value", "gain", "gain_pct", "name", "added"].includes(param(sp, "sort") ?? "") ? param(sp, "sort") : "value") as Sort;

  if (entries.length === 0) {
    return (
      <>
        <PageHeader title="My collection" />
        <EmptyState
          icon={Library}
          title="Start tracking your collection"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild variant="primary"><Link href="/collection/add?type=sealed"><Plus /> Add sealed product</Link></Button>
              <Button asChild><Link href="/collection/add?type=card"><Plus /> Add a card</Link></Button>
            </div>
          }
        >
          Record what you paid, including fees and shipping, and see what your sealed products and cards are worth at
          today&apos;s market prices. Each purchase is its own lot, so your cost basis stays exact.
        </EmptyState>
      </>
    );
  }

  const byId = new Map(entries.map((e) => [e.id, e]));
  const filtered = entries.filter(
    (e) =>
      (!type || e.type === type) &&
      (!q || `${e.name} ${e.setName ?? ""} ${e.detail ?? ""}`.toLowerCase().includes(q)) &&
      (!status || e.valuation.priceStatus === status),
  );
  const positions = groupPositions(filtered.map((e) => e.valuation));
  const num = (d: { toNumber(): number } | null) => (d === null ? -Infinity : d.toNumber());
  positions.sort((a, b) => {
    switch (sort) {
      case "gain":
        return num(b.gain) - num(a.gain);
      case "gain_pct":
        return num(b.gainPct) - num(a.gainPct);
      case "name":
        return a.itemName.localeCompare(b.itemName);
      case "added":
        return Math.max(...b.lots.map((l) => Date.parse(byId.get(l.lot.id)!.createdAt))) - Math.max(...a.lots.map((l) => Date.parse(byId.get(l.lot.id)!.createdAt)));
      default:
        return num(b.marketValue) - num(a.marketValue);
    }
  });

  const primary = totals.find((t) => t.currency === currency) ?? totals[0];
  const others = totals.filter((t) => t !== primary);
  const entryOf = (p: PositionSummary) => byId.get(p.lots[0].lot.id)!;
  const qs = (patch: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    const cur = { type, q: param(sp, "q"), view, status, sort, ...patch };
    for (const [k, v] of Object.entries(cur)) if (v) u.set(k, v);
    return `?${u}`;
  };

  return (
    <>
      <PageHeader
        title="My collection"
        description="Valued at the latest stored market price. Missing or stale prices are flagged, never treated as current."
        actions={
          <>
            <Button asChild variant="primary"><Link href="/collection/add"><Plus /> Add item</Link></Button>
            <Button asChild><a href="/api/export/collection" download><Download /> Export CSV</a></Button>
          </>
        }
      />
      {param(sp, "saved") ? <Notice tone="success" className="mb-4">Saved.</Notice> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Market value" value={<Money value={primary.marketValue} currency={primary.currency} />} sub={`${primary.sealedQuantity} sealed · ${primary.cardQuantity} cards`} />
        <Stat label="Total cost basis" value={<Money value={primary.costBasis} currency={primary.currency} />} sub="Incl. recorded fees and shipping" />
        <Stat
          label="Unrealized gain / loss"
          value={<Money value={primary.unrealizedGain} currency={primary.currency} signed />}
          sub={<><Percent value={primary.unrealizedGainPct} /> on priced lots</>}
        />
        <Stat label="Sealed vs. cards" value={<Money value={primary.sealedValue} currency={primary.currency} />} sub={<>Cards: <Money value={primary.cardValue} currency={primary.currency} /></>} />
      </div>
      {primary.missingPriceLots || primary.stalePriceLots ? (
        <Notice tone="warn" className="mt-3">
          <AlertTriangle className="mr-1 inline size-4 align-text-bottom" aria-hidden />
          {primary.missingPriceLots ? `${primary.missingPriceLots} lot(s) have no usable price and are excluded from market value and gain/loss. ` : ""}
          {primary.stalePriceLots ? `${primary.stalePriceLots} lot(s) use a stale price.` : ""}
        </Notice>
      ) : null}
      {others.length ? (
        <Notice tone="info" className="mt-3">
          Also held in other currencies (not converted):{" "}
          {others.map((t) => (
            <span key={t.currency} className="mr-3"><Money value={t.marketValue} currency={t.currency} /> value, <Money value={t.unrealizedGain} currency={t.currency} signed /> gain</span>
          ))}
        </Notice>
      ) : null}

      <form method="get" className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <input type="hidden" name="view" value={view} />
        <Field label="Search" htmlFor="q" className="col-span-2">
          <Input id="q" name="q" defaultValue={param(sp, "q")} placeholder="Name, set, condition" />
        </Field>
        <Field label="Type" htmlFor="type">
          <Select id="type" name="type" defaultValue={type ?? ""}>
            <option value="">All</option>
            <option value="sealed">Sealed</option>
            <option value="card">Cards</option>
          </Select>
        </Field>
        <Field label="Price status" htmlFor="status">
          <Select id="status" name="status" defaultValue={status ?? ""}>
            <option value="">Any</option>
            <option value="fresh">Current</option>
            <option value="stale">Stale</option>
            <option value="missing">No price</option>
            <option value="manual">Manual value</option>
          </Select>
        </Field>
        <Field label="Sort" htmlFor="sort">
          <Select id="sort" name="sort" defaultValue={sort}>
            <option value="value">Market value</option>
            <option value="gain">Gain ($)</option>
            <option value="gain_pct">Gain (%)</option>
            <option value="name">Name</option>
            <option value="added">Recently added</option>
          </Select>
        </Field>
        <div className="col-span-2 flex items-center gap-2 sm:col-span-5">
          <Button type="submit" size="sm">Apply</Button>
          <Button asChild size="sm" variant="ghost"><Link href="/collection">Reset</Link></Button>
          <div className="ml-auto flex gap-1" aria-label="View">
            <Button asChild size="icon" variant={view === "table" ? "secondary" : "ghost"} aria-label="Table view"><Link href={qs({ view: "table" })}><Rows3 /></Link></Button>
            <Button asChild size="icon" variant={view === "grid" ? "secondary" : "ghost"} aria-label="Grid view"><Link href={qs({ view: "grid" })}><LayoutGrid /></Link></Button>
          </div>
        </div>
      </form>

      {positions.length === 0 ? (
        <p className="mt-6 text-sm text-muted">No items match these filters.</p>
      ) : view === "grid" ? (
        <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {positions.map((p) => {
            const e = entryOf(p);
            return (
              <li key={`${p.itemKey}|${p.currency}`} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3">
                <CatalogImage src={e.imageUrl} alt={p.itemName} aspect={e.type === "sealed" ? "square" : "card"} />
                <div className="text-sm font-medium leading-tight">{e.href ? <Link href={e.href} className="hover:text-accent">{p.itemName}</Link> : p.itemName}</div>
                <div className="text-xs text-muted">{p.quantity} owned · {p.lots.length} lot{p.lots.length > 1 ? "s" : ""}</div>
                <div className="text-sm"><Money value={p.marketValue} currency={p.currency} /></div>
                <div className="text-xs"><Money value={p.gain} currency={p.currency} signed /> (<Percent value={p.gainPct} />)</div>
                <StatusBadge s={p.priceStatus} />
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-4 rounded-xl border border-border bg-surface">
          <Table>
            <thead>
              <tr>
                <Th>Item</Th>
                <Th className="text-right">Qty</Th>
                <Th className="text-right">Avg. cost</Th>
                <Th className="text-right">Cost basis</Th>
                <Th className="text-right">Unit value</Th>
                <Th className="text-right">Market value</Th>
                <Th className="text-right">Gain / loss</Th>
                <Th><span className="sr-only">Actions</span></Th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => {
                const e = entryOf(p);
                const multi = p.lots.length > 1;
                return (
                  <PositionRows key={`${p.itemKey}|${p.currency}`} p={p} e={e} multi={multi} byId={byId} />
                );
              })}
            </tbody>
          </Table>
        </div>
      )}
    </>
  );
}

function LotActions({ e }: { e: CollectionEntry }) {
  return (
    <div className="flex justify-end gap-1">
      <Button asChild variant="ghost" size="icon" aria-label={`Edit ${e.name} lot`}>
        <Link href={`/collection/edit/${e.type}/${e.id}`}><Pencil /></Link>
      </Button>
      <ConfirmDelete action={deleteLot} fields={{ type: e.type, id: e.id }} size="icon" label={`Delete ${e.name} lot`} title="Delete this lot?" description={`Remove ${e.valuation.lot.quantity} × ${e.name} bought ${formatDate(e.valuation.lot.purchaseDate ?? null)} from your collection.`} />
    </div>
  );
}

function PositionRows({ p, e, multi, byId }: { p: PositionSummary; e: CollectionEntry; multi: boolean; byId: Map<string, CollectionEntry> }) {
  return (
    <>
      <tr className={cn(multi && "bg-surface-2/40")}>
        <Td>
          <div className="flex items-center gap-3">
            <CatalogImage src={e.imageUrl} alt="" aspect={e.type === "sealed" ? "square" : "card"} className="w-9 shrink-0" />
            <div>
              <div className="font-medium">{e.href ? <Link href={e.href} className="hover:text-accent">{p.itemName}</Link> : p.itemName}</div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                {e.type === "sealed" ? "Sealed" : "Card"}
                {e.setName ? ` · ${e.setName}` : ""}
                {!multi && e.detail ? ` · ${e.detail}` : ""}
                {multi ? ` · ${p.lots.length} lots` : ""}
                <StatusBadge s={p.priceStatus} />
                {!multi && e.priceKind && e.priceKind !== "provider" ? <PriceKindBadge kind={e.priceKind} /> : null}
                {!multi && e.valuation.warnings.length ? <Badge tone="warn" title={e.valuation.warnings.join(" ")}>Note</Badge> : null}
              </div>
            </div>
          </div>
        </Td>
        <Td className="text-right">{p.quantity}</Td>
        <Td className="text-right"><Money value={p.averageUnitCost} currency={p.currency} /></Td>
        <Td className="text-right"><Money value={p.costBasis} currency={p.currency} /></Td>
        <Td className="text-right">{!multi ? <Money value={p.lots[0].unitValue} currency={p.currency} /> : null}</Td>
        <Td className="text-right"><Money value={p.marketValue} currency={p.currency} /></Td>
        <Td className="text-right">
          <div><Money value={p.gain} currency={p.currency} signed /></div>
          <div className="text-xs"><Percent value={p.gainPct} /></div>
        </Td>
        <Td>{!multi ? <LotActions e={e} /> : null}</Td>
      </tr>
      {multi
        ? p.lots.map((l) => {
            const le = byId.get(l.lot.id)!;
            return (
              <tr key={l.lot.id} className="text-xs text-muted">
                <Td className="pl-14">
                  Lot bought {formatDate(l.lot.purchaseDate ?? null)}
                  {le.detail ? ` · ${le.detail}` : ""} <StatusBadge s={l.priceStatus} />
                </Td>
                <Td className="text-right">{l.lot.quantity}</Td>
                <Td className="text-right"><Money value={l.unitCostBasis} currency={p.currency} /></Td>
                <Td className="text-right"><Money value={l.costBasis} currency={p.currency} /></Td>
                <Td className="text-right"><Money value={l.unitValue} currency={p.currency} /></Td>
                <Td className="text-right"><Money value={l.marketValue} currency={p.currency} /></Td>
                <Td className="text-right"><Money value={l.gain} currency={p.currency} signed /> <Percent value={l.gainPct} /></Td>
                <Td><LotActions e={le} /></Td>
              </tr>
            );
          })
        : null}
    </>
  );
}
