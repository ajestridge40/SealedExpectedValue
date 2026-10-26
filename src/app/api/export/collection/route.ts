import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { getCollection } from "@/lib/data/collection";
import { dec, toMoneyString, type Decimal } from "@/lib/money";

/** The signed-in user's collection as CSV (one row per lot). */
export async function GET() {
  if (!(await getUser())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { entries } = await getCollection();
  const m = (d: Decimal | null, currency: string) => (d === null ? "" : toMoneyString(d, currency));
  const csv = toCsv(entries, [
    { header: "type", value: (e) => e.type },
    { header: "name", value: (e) => e.name },
    { header: "set", value: (e) => e.setName },
    { header: "details", value: (e) => e.detail },
    { header: "quantity", value: (e) => e.valuation.lot.quantity },
    { header: "currency", value: (e) => e.valuation.lot.currency },
    { header: "purchase_price_per_unit", value: (e) => m(dec(e.valuation.lot.unitPrice), e.valuation.lot.currency) },
    {
      header: "fees_and_shipping",
      value: (e) =>
        m(e.valuation.costBasis.minus(dec(e.valuation.lot.unitPrice).times(e.valuation.lot.quantity)), e.valuation.lot.currency),
    },
    { header: "purchase_date", value: (e) => e.valuation.lot.purchaseDate ?? "" },
    { header: "cost_basis", value: (e) => m(e.valuation.costBasis, e.valuation.lot.currency) },
    { header: "unit_market_value", value: (e) => m(e.valuation.unitValue, e.valuation.lot.currency) },
    { header: "market_value", value: (e) => m(e.valuation.marketValue, e.valuation.lot.currency) },
    { header: "unrealized_gain", value: (e) => m(e.valuation.gain, e.valuation.lot.currency) },
    { header: "unrealized_gain_pct", value: (e) => (e.valuation.gainPct === null ? "" : e.valuation.gainPct.toFixed(2)) },
    { header: "price_status", value: (e) => e.valuation.priceStatus },
    { header: "price_as_of", value: (e) => e.valuation.priceAsOf?.toISOString() ?? "" },
    { header: "notes", value: (e) => e.sealed?.notes ?? e.card?.notes ?? "" },
  ]);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sealedev-collection-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
