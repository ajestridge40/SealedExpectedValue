import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { deleteLot } from "@/app/actions/collection";
import { ConfirmDelete } from "@/components/confirm-delete";
import { LotForm } from "@/components/lot-form";
import { PageHeader } from "@/components/page";
import { Card, CardContent } from "@/components/ui/card";
import { getLot, type CardLotRow, type SealedLotRow } from "@/lib/data/collection";

export const metadata: Metadata = { title: "Edit lot" };

export default async function EditLotPage({ params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await params;
  if (type !== "sealed" && type !== "card") notFound();
  const lot = await getLot(type, id);
  if (!lot) notFound();

  const label =
    type === "sealed"
      ? ((lot as SealedLotRow).sealed_products?.name ?? null)
      : (lot as CardLotRow).cards
        ? `${(lot as CardLotRow).cards!.name} ${(lot as CardLotRow).cards!.number ?? ""} · ${(lot as CardLotRow).cards!.printing}`
        : null;
  const itemId = type === "sealed" ? (lot as SealedLotRow).sealed_product_id : (lot as CardLotRow).card_id;

  return (
    <>
      <PageHeader
        title="Edit lot"
        actions={
          <ConfirmDelete
            action={deleteLot}
            fields={{ type, id }}
            label="Delete lot"
            title="Delete this lot?"
            description="This permanently removes the purchase record from your collection."
            size="md"
          />
        }
      />
      <Card className="max-w-3xl">
        <CardContent className="pt-5 sm:pt-5">
          <LotForm type={type} itemLabel={label} defaults={{ ...lot, item_id: itemId }} />
        </CardContent>
      </Card>
    </>
  );
}
