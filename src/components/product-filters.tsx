import Link from "next/link";
import type { Game, SetRow } from "@/lib/data/types";
import { PRODUCT_TYPE_LABELS } from "@/lib/data/types";
import type { ProductFilters } from "@/lib/data/summaries";
import { Button } from "./ui/button";
import { Field, Input, Select } from "./ui/form";

/** GET form: filter state lives in the URL, so results are shareable and work without JS. */
export function ProductFiltersForm({ f, games, sets }: { f: ProductFilters; games: Game[]; sets: SetRow[] }) {
  return (
    <form
      method="get"
      className="border-border bg-surface grid grid-cols-2 gap-3 rounded-xl border p-4 sm:grid-cols-3 lg:grid-cols-6"
    >
      <Field label="Search" htmlFor="q" className="col-span-2 sm:col-span-3 lg:col-span-2">
        <Input id="q" name="q" defaultValue={f.q} placeholder="Product or set name" />
      </Field>
      <Field label="Game" htmlFor="game">
        <Select id="game" name="game" defaultValue={f.game ?? ""}>
          <option value="">All games</option>
          {games.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Set" htmlFor="set">
        <Select id="set" name="set" defaultValue={f.set ?? ""} disabled={sets.length === 0}>
          <option value="">{sets.length ? "All sets" : "Pick a game first"}</option>
          {sets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Product type" htmlFor="type">
        <Select id="type" name="type" defaultValue={f.type ?? ""}>
          <option value="">All types</option>
          {Object.entries(PRODUCT_TYPE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Sort by" htmlFor="sort">
        <Select id="sort" name="sort" defaultValue={f.sort ?? "ratio"}>
          <option value="ratio">Best EV-to-price</option>
          <option value="ev">Highest EV</option>
          <option value="price">Lowest price</option>
          <option value="net">Best net return</option>
          <option value="release">Newest release</option>
          <option value="top5">Best top-5 cards / price</option>
          <option value="change">Biggest 7-day drop</option>
        </Select>
      </Field>
      <Field label="Min price" htmlFor="minPrice">
        <Input
          id="minPrice"
          name="minPrice"
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          defaultValue={f.minPrice}
        />
      </Field>
      <Field label="Max price" htmlFor="maxPrice">
        <Input
          id="maxPrice"
          name="maxPrice"
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          defaultValue={f.maxPrice}
        />
      </Field>
      <Field label="Min EV / price" htmlFor="minRatio">
        <Input
          id="minRatio"
          name="minRatio"
          type="number"
          min={0}
          step="0.05"
          inputMode="decimal"
          defaultValue={f.minRatio}
          placeholder="e.g. 1.0"
        />
      </Field>
      <Field label="Net EV" htmlFor="net">
        <Select id="net" name="net" defaultValue={f.net ?? ""}>
          <option value="">Any</option>
          <option value="positive">Positive only</option>
          <option value="negative">Negative only</option>
        </Select>
      </Field>
      <Field label="Min confidence" htmlFor="confidence">
        <Select id="confidence" name="confidence" defaultValue={f.confidence ?? ""}>
          <option value="">Any (incl. insufficient)</option>
          <option value="low">Low or better</option>
          <option value="medium">Medium or better</option>
          <option value="high">High only</option>
        </Select>
      </Field>
      <div className="col-span-2 flex items-end gap-2 sm:col-span-1">
        <Button type="submit" variant="primary" className="flex-1">
          Apply
        </Button>
        <Button asChild variant="ghost">
          <Link href="?">Reset</Link>
        </Button>
      </div>
    </form>
  );
}
