"use client";

import { useState } from "react";
import { calculateReturns } from "@/lib/ev/returns";
import { Decimal, formatMoney, formatPercent, formatRatio } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/form";

/** "What if I paid X?" for each compared product, without touching market data. */
export function CompareScenario({
  products,
}: {
  products: { id: string; name: string; ev: string | null; price: string | null; currency: string }[];
}) {
  const [prices, setPrices] = useState<Record<string, string>>(
    Object.fromEntries(products.map((p) => [p.id, p.price ? Number(p.price).toFixed(2) : ""])),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your purchase price</CardTitle>
        <CardDescription>
          Enter what you would actually pay for each product to compare expected net returns.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {products.map((p) => {
          const r = calculateReturns({ grossEv: p.ev ? new Decimal(p.ev) : null, purchasePrice: prices[p.id] || null });
          const tone = r.netEv ? (r.netEv.gt(0) ? "text-gain" : r.netEv.lt(0) ? "text-loss" : "") : "";
          return (
            <div key={p.id} className="border-border flex flex-col gap-2 rounded-lg border p-3">
              <label htmlFor={`cmp-${p.id}`} className="text-sm font-medium">
                {p.name}
              </label>
              <Input
                id={`cmp-${p.id}`}
                inputMode="decimal"
                value={prices[p.id]}
                onChange={(e) => setPrices((s) => ({ ...s, [p.id]: e.target.value }))}
              />
              {p.ev === null ? (
                <p className="text-muted text-xs">No EV estimate available.</p>
              ) : r.status === "invalid_price" ? (
                <p className="text-loss text-xs">Enter a price above 0.</p>
              ) : (
                <dl className="grid grid-cols-2 gap-1 text-xs">
                  <dt className="text-muted">Net return</dt>
                  <dd className={cn("tabular text-right font-medium", tone)}>
                    {formatMoney(r.netEv, p.currency, { signed: true })}
                  </dd>
                  <dt className="text-muted">Return %</dt>
                  <dd className={cn("tabular text-right", tone)}>{formatPercent(r.netReturnPct, { signed: true })}</dd>
                  <dt className="text-muted">EV / price</dt>
                  <dd className="tabular text-right">{formatRatio(r.evToPrice)}</dd>
                </dl>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
