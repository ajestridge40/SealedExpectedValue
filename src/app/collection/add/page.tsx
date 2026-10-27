import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LotForm } from "@/components/lot-form";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { getProfile, requireUser } from "@/lib/auth";
import { getCardById, searchCards } from "@/lib/data/catalog";
import { getProductSummaries, searchProductOptions } from "@/lib/data/products";
import { param } from "@/lib/utils";

export const metadata: Metadata = { title: "Add to collection" };

export default async function AddLotPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser("/collection/add");
  const sp = await searchParams;
  const type = param(sp, "type") === "card" ? "card" : "sealed";
  const item = param(sp, "item");
  const custom = param(sp, "custom") === "1";
  const currency = (await getProfile())?.default_currency ?? "USD";

  const tabs = (
    <div className="mb-4 flex gap-2" role="tablist" aria-label="Item type">
      {(["sealed", "card"] as const).map((t) => (
        <Button key={t} asChild size="sm" variant={t === type ? "primary" : "secondary"}>
          <Link href={`/collection/add?type=${t}`} role="tab" aria-selected={t === type}>
            {t === "sealed" ? "Sealed product" : "Single card"}
          </Link>
        </Button>
      ))}
    </div>
  );

  if (item || custom) {
    let label: string | null = null;
    if (item) {
      if (type === "sealed") {
        const [p] = /^[0-9a-f-]{36}$/i.test(item) ? await getProductSummaries([item]) : [];
        if (!p) notFound();
        label = p.name;
      } else {
        const c = await getCardById(item);
        if (!c) notFound();
        label = `${c.name}${c.number ? ` ${c.number}` : ""} · ${c.printing}`;
      }
    }
    return (
      <>
        <PageHeader
          title={`Add a ${type === "sealed" ? "sealed product" : "card"} lot`}
          description="One lot = one purchase. Add separate lots for purchases at different prices or dates."
        />
        <Card className="max-w-3xl">
          <CardContent className="pt-5 sm:pt-5">
            <LotForm type={type} itemLabel={label} defaults={{ item_id: item ?? null, currency }} />
          </CardContent>
        </Card>
      </>
    );
  }

  if (type === "sealed") {
    const q = param(sp, "q");
    const matches = q ? await searchProductOptions(q, 30) : [];
    return (
      <>
        <PageHeader title="Add to collection" />
        {tabs}
        <Card className="max-w-3xl">
          <CardContent className="flex flex-col gap-4 pt-5 sm:pt-5">
            <form method="get" className="flex items-end gap-2">
              <input type="hidden" name="type" value="sealed" />
              <Field label="Find a sealed product" htmlFor="q" className="flex-1">
                <Input id="q" name="q" defaultValue={q} placeholder="Product or set name" />
              </Field>
              <Button type="submit">Search</Button>
            </form>
            {q && matches.length === 0 ? <p className="text-muted text-sm">No products found for “{q}”.</p> : null}
            {matches.length ? (
              <ul className="divide-border border-border divide-y rounded-lg border">
                {matches.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span>
                      <span className="font-medium">{m.name}</span>
                      {m.setName ? <span className="text-muted text-xs"> · {m.setName}</span> : null}
                    </span>
                    <Button asChild size="sm">
                      <Link href={`/collection/add?type=sealed&item=${m.id}`}>Select</Link>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            <Link href="/collection/add?type=sealed&custom=1" className="text-accent text-sm hover:underline">
              Not listed? Add a custom item
            </Link>
          </CardContent>
        </Card>
      </>
    );
  }

  const q = param(sp, "q");
  const results = q ? (await searchCards({ q, pageSize: 30 })).rows : [];
  return (
    <>
      <PageHeader title="Add to collection" />
      {tabs}
      <Card className="max-w-3xl">
        <CardContent className="flex flex-col gap-4 pt-5 sm:pt-5">
          <form method="get" className="flex items-end gap-2">
            <input type="hidden" name="type" value="card" />
            <Field label="Find a card" htmlFor="q" className="flex-1">
              <Input id="q" name="q" defaultValue={q} placeholder="Card name" />
            </Field>
            <Button type="submit">Search</Button>
          </form>
          {q && results.length === 0 ? <p className="text-muted text-sm">No cards found for “{q}”.</p> : null}
          {results.length ? (
            <ul className="divide-border border-border divide-y rounded-lg border">
              {results.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div>
                    <div className="font-medium">
                      {c.name} <span className="text-muted text-xs">{c.number}</span>
                    </div>
                    <div className="text-muted text-xs">
                      {c.rarity} · {c.printing}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Money value={c.current_price} currency={c.current_price_currency ?? "USD"} />
                    <Button asChild size="sm">
                      <Link href={`/collection/add?type=card&item=${c.id}`}>Select</Link>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          <Link href="/collection/add?type=card&custom=1" className="text-accent text-sm hover:underline">
            Not listed? Add a custom card
          </Link>
        </CardContent>
      </Card>
    </>
  );
}
