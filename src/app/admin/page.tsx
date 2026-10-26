import type { Metadata } from "next";
import { CsvImportForm, JobButtons } from "@/components/admin-forms";
import { PageHeader, Stat } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage() {
  await requireAdmin();
  const supabase = await createClient();
  const count = async (table: string, notNull?: string) => {
    let q = supabase.from(table).select("id", { count: "exact", head: true });
    if (notNull) q = q.not(notNull, "is", null);
    return (await q).count ?? 0;
  };
  const [products, linkedProducts, pricedProducts, cards, pricedCards, sets, linkedSets, jobs] = await Promise.all([
    count("sealed_products"),
    count("sealed_products", "tcgplayer_product_id"),
    count("sealed_products", "current_price"),
    count("cards"),
    count("cards", "current_price"),
    count("sets"),
    count("sets", "tcgplayer_group_id"),
    supabase.from("job_runs").select("id, job, status, started_at, finished_at, details").order("started_at", { ascending: false }).limit(10),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Admin" description="Catalog import, price refresh and price imports. Admin rights are set in the database (profiles.is_admin)." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sets linked to TCGplayer" value={`${linkedSets} / ${sets}`} />
        <Stat label="Products linked" value={`${linkedProducts} / ${products}`} />
        <Stat label="Products with a price" value={`${pricedProducts} / ${products}`} />
        <Stat label="Cards with a price" value={`${pricedCards.toLocaleString()} / ${cards.toLocaleString()}`} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Catalog and prices</CardTitle>
          <CardDescription>
            Import links sets/products to TCGplayer ids by exact name match and loads every card in linked sets. The
            refresh then stores one price snapshot per item per day. The scheduled job does the same daily.
          </CardDescription>
        </CardHeader>
        <CardContent><JobButtons /></CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Import prices from CSV</CardTitle>
          <CardDescription>
            Columns: <code>item_type</code> (sealed|card), <code>item_id</code> or <code>tcgplayer_product_id</code>,{" "}
            <code>printing</code>, <code>market_price</code>, <code>currency</code>, <code>as_of</code>, <code>note</code>. Max 1 MB /
            5,000 rows. Stored as “CSV import”, never as live provider data.
          </CardDescription>
        </CardHeader>
        <CardContent><CsvImportForm /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Recent jobs</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <thead><tr><Th>Job</Th><Th>Status</Th><Th>Started</Th><Th>Finished</Th><Th>Details</Th></tr></thead>
            <tbody>
              {(jobs.data ?? []).map((j) => {
                const d = (j.details ?? {}) as { snapshotsWritten?: number; setsProcessed?: number; errors?: string[]; reason?: string };
                return (
                  <tr key={j.id}>
                    <Td>{j.job}</Td>
                    <Td><Badge tone={j.status === "succeeded" ? "gain" : j.status === "failed" ? "loss" : "neutral"}>{j.status}</Badge></Td>
                    <Td>{formatDateTime(j.started_at)}</Td>
                    <Td>{formatDateTime(j.finished_at)}</Td>
                    <Td className="text-xs text-muted">
                      {d.snapshotsWritten !== undefined ? `${d.snapshotsWritten} prices, ${d.setsProcessed} sets` : ""}
                      {d.reason ?? ""}
                      {d.errors?.length ? ` · ${d.errors.length} error(s): ${d.errors.slice(0, 2).join("; ")}` : ""}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          {!jobs.data?.length ? <p className="text-sm text-muted">No runs yet.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
