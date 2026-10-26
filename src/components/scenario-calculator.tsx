"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { breakEvenPrice, calculateReturns } from "@/lib/ev/returns";
import { Decimal, formatMoney, formatPercent, formatRatio } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Input, Label } from "./ui/form";

/**
 * Hypothetical purchase prices against the same gross EV. Changing a price
 * never changes the EV or any stored market data.
 */
export function ScenarioCalculator({
  ev,
  currency,
  marketPrice,
}: {
  ev: string | null;
  currency: string;
  marketPrice: string | null;
}) {
  const base = marketPrice ? Number(marketPrice) : ev ? Number(ev) : 100;
  const round = (n: number) => String(Math.max(1, Math.round(n)));
  const [prices, setPrices] = useState<string[]>([round(base * 0.85), round(base), round(base * 1.15)]);
  const [costs, setCosts] = useState("0");
  const gross = ev ? new Decimal(ev) : null;
  const be = breakEvenPrice(gross, /^\d+(\.\d+)?$/.test(costs) ? costs : 0);

  if (!gross) {
    return (
      <p className="text-muted text-sm">
        The scenario calculator needs an EV estimate, which is not available for this product.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="opening-costs">Extra costs per product (shipping, tax, fees)</Label>
          <Input
            id="opening-costs"
            inputMode="decimal"
            className="w-40"
            value={costs}
            onChange={(e) => setCosts(e.target.value)}
          />
        </div>
        <p className="text-muted text-sm">
          Break-even purchase price: <span className="text-fg font-medium">{formatMoney(be, currency)}</span>
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="tabular w-full text-sm">
          <caption className="sr-only">Net return at different purchase prices</caption>
          <thead>
            <tr className="text-muted text-left text-xs">
              <th className="py-2 pr-3 font-medium">You pay</th>
              <th className="py-2 pr-3 font-medium">Est. EV</th>
              <th className="py-2 pr-3 font-medium">Est. net return</th>
              <th className="py-2 pr-3 font-medium">Return %</th>
              <th className="py-2 pr-3 font-medium">EV / price</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {prices.map((p, i) => {
              const r = calculateReturns({
                grossEv: gross,
                purchasePrice: p,
                openingCosts: /^\d+(\.\d+)?$/.test(costs) ? costs : null,
              });
              const tone = r.netEv ? (r.netEv.gt(0) ? "text-gain" : r.netEv.lt(0) ? "text-loss" : "") : "";
              return (
                <tr key={i} className="border-border/60 border-t">
                  <td className="py-2 pr-3">
                    <label className="sr-only" htmlFor={`scenario-${i}`}>
                      Scenario {i + 1} purchase price
                    </label>
                    <Input
                      id={`scenario-${i}`}
                      inputMode="decimal"
                      className="h-8 w-28"
                      value={p}
                      onChange={(e) => setPrices((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))}
                    />
                  </td>
                  <td className="py-2 pr-3">{formatMoney(gross, currency)}</td>
                  <td className={cn("py-2 pr-3 font-medium", tone)}>
                    {r.status === "invalid_price" ? (
                      <span className="text-loss text-xs">Enter a price above 0</span>
                    ) : (
                      formatMoney(r.netEv, currency, { signed: true })
                    )}
                  </td>
                  <td className={cn("py-2 pr-3", tone)}>{formatPercent(r.netReturnPct, { signed: true })}</td>
                  <td className="py-2 pr-3">{formatRatio(r.evToPrice)}</td>
                  <td className="py-2 text-right">
                    {prices.length > 1 ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove scenario ${i + 1}`}
                        onClick={() => setPrices((xs) => xs.filter((_, j) => j !== i))}
                      >
                        <X />
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {prices.length < 6 ? (
        <Button size="sm" className="self-start" onClick={() => setPrices((xs) => [...xs, round(base)])}>
          <Plus /> Add scenario
        </Button>
      ) : null}
      <p className="text-subtle text-xs">
        Net return = EV − price − extra costs. It is an average: most individual boxes land well below or above it.
      </p>
    </div>
  );
}
