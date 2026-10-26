"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface ChartPoint {
  t: string; // ISO timestamp
  price: number; // display only; values come from numeric(12,2) columns
  kind: string;
}

const fmtDate = (t: string) =>
  new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function PriceChart({ points, currency = "USD" }: { points: ChartPoint[]; currency?: string }) {
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency });
  if (points.length < 2) {
    return (
      <p className="text-muted py-8 text-center text-sm">
        {points.length === 0
          ? "No price history yet. History builds up from each daily price refresh."
          : "Only one price snapshot so far. The chart appears after the next refresh."}
      </p>
    );
  }
  const first = points[0].price;
  const last = points[points.length - 1].price;
  const color = last >= first ? "var(--color-gain)" : "var(--color-loss)";
  return (
    <div
      className="h-56 w-full"
      role="img"
      aria-label={`Price history from ${fmtDate(points[0].t)} to ${fmtDate(points[points.length - 1].t)}, ${money.format(first)} to ${money.format(last)}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="t"
            tickFormatter={fmtDate}
            stroke="var(--color-subtle)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
          />
          <YAxis
            stroke="var(--color-subtle)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={56}
            domain={["auto", "auto"]}
            tickFormatter={(v: number) => money.format(v)}
          />
          <Tooltip
            contentStyle={{
              background: "var(--color-surface-2)",
              border: "1px solid var(--color-border-strong)",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(t) => new Date(String(t)).toUTCString()}
            formatter={(v, _n, item) => [
              money.format(Number(v)),
              `Market price (${(item.payload as ChartPoint).kind.replace("_", " ")})`,
            ]}
          />
          <Area
            type="monotone"
            dataKey="price"
            stroke={color}
            strokeWidth={2}
            fill="url(#priceFill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
