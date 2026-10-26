"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

/** Stable, distinguishable colors per game (by slug-ish name). */
const GAME_COLORS: Record<string, string> = {
  "Pokémon TCG": "#ef5350",
  "Disney Lorcana": "#7c4dff",
  "One Piece Card Game": "#ff8a3d",
  "Star Wars: Unlimited": "#ffb800",
  Riftbound: "#00bcd4",
  "Magic: The Gathering": "#4fc3c7",
  "Yu-Gi-Oh!": "#e9b949",
};
const colorFor = (game: string) => GAME_COLORS[game] ?? "#9aa4b6";

const tooltipStyle = {
  background: "var(--color-surface-2)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: 8,
  fontSize: 12,
};

export interface RatioPoint {
  name: string;
  game: string;
  ratio: number;
}

/** Bar chart of value ratios with a dashed break-even line at 1.0×. */
export function RatioBarChart({ data, label }: { data: RatioPoint[]; label: string }) {
  if (data.length === 0) return <p className="text-muted py-8 text-center text-sm">No priced products yet.</p>;
  const games = [...new Set(data.map((d) => d.game))];
  return (
    <div>
      <div
        className="h-72 w-full"
        role="img"
        aria-label={`${label} for ${data.length} products; dashed line marks 1.0×`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 72, left: 0 }}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="name"
              stroke="var(--color-subtle)"
              fontSize={10}
              tickLine={false}
              angle={-40}
              textAnchor="end"
              interval={0}
              height={72}
              tickFormatter={(v: string) => (v.length > 22 ? `${v.slice(0, 21)}…` : v)}
            />
            <YAxis
              stroke="var(--color-subtle)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              width={40}
              tickFormatter={(v: number) => `${v.toFixed(1)}×`}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v) => [`${Number(v).toFixed(2)}×`, label]}
              cursor={{ fill: "var(--color-surface-3)" }}
            />
            <ReferenceLine
              y={1}
              stroke="var(--color-muted)"
              strokeDasharray="6 4"
              label={{ value: "Break-even 1.0×", fill: "var(--color-muted)", fontSize: 11, position: "insideTopRight" }}
            />
            <Bar dataKey="ratio" isAnimationActive={false} radius={[3, 3, 0, 0]}>
              {data.map((d) => (
                <Cell key={d.name} fill={colorFor(d.game)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <Legend games={games} />
    </div>
  );
}

export interface ScatterPoint {
  name: string;
  game: string;
  price: number;
  value: number;
}

/** Price (x) vs value (y). Points above the dashed y = x line are worth more than they cost. */
export function PriceValueScatter({ data, valueLabel }: { data: ScatterPoint[]; valueLabel: string }) {
  if (data.length === 0) return <p className="text-muted py-8 text-center text-sm">No priced products yet.</p>;
  const max = Math.max(...data.flatMap((d) => [d.price, d.value])) * 1.05;
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const games = [...new Set(data.map((d) => d.game))];
  return (
    <div>
      <div
        className="h-80 w-full"
        role="img"
        aria-label={`Market price versus ${valueLabel} for ${data.length} products`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="price"
              name="Price"
              domain={[0, max]}
              stroke="var(--color-subtle)"
              fontSize={11}
              tickFormatter={(v: number) => money.format(v)}
            />
            <YAxis
              type="number"
              dataKey="value"
              name={valueLabel}
              domain={[0, max]}
              stroke="var(--color-subtle)"
              fontSize={11}
              width={56}
              tickFormatter={(v: number) => money.format(v)}
            />
            <ZAxis range={[60, 60]} />
            <ReferenceLine
              segment={[
                { x: 0, y: 0 },
                { x: max, y: max },
              ]}
              stroke="var(--color-muted)"
              strokeDasharray="6 4"
              ifOverflow="extendDomain"
            />
            <Tooltip
              contentStyle={tooltipStyle}
              cursor={{ strokeDasharray: "3 3" }}
              content={({ payload }) => {
                const d = payload?.[0]?.payload as ScatterPoint | undefined;
                if (!d) return null;
                return (
                  <div style={tooltipStyle} className="px-3 py-2">
                    <div className="font-medium">{d.name}</div>
                    <div className="text-muted">Price {money.format(d.price)}</div>
                    <div className="text-muted">
                      {valueLabel} {money.format(d.value)} ({(d.value / d.price).toFixed(2)}×)
                    </div>
                  </div>
                );
              }}
            />
            {games.map((g) => (
              <Scatter
                key={g}
                name={g}
                data={data.filter((d) => d.game === g)}
                fill={colorFor(g)}
                isAnimationActive={false}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <Legend games={games} />
    </div>
  );
}

function Legend({ games }: { games: string[] }) {
  return (
    <ul className="text-muted mt-2 flex flex-wrap gap-3 text-xs">
      {games.map((g) => (
        <li key={g} className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full" style={{ background: colorFor(g) }} />
          {g}
        </li>
      ))}
    </ul>
  );
}
