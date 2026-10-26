"use client";

import Link from "next/link";
import { useActionState } from "react";
import { saveLot, type LotFormState } from "@/app/actions/collection";
import { Notice } from "./page";
import { Button } from "./ui/button";
import { Field, Input, Select, Textarea } from "./ui/form";

export interface LotDefaults {
  id?: string;
  item_id?: string | null;
  custom_name?: string | null;
  custom_set_name?: string | null;
  quantity?: number;
  purchase_price_per_unit?: number | string;
  currency?: string;
  purchase_date?: string | null;
  fees?: number | string;
  shipping?: number | string;
  condition?: string | null;
  storage_location?: string | null;
  notes?: string | null;
  manual_unit_value?: number | string | null;
  language?: string;
  grading_company?: string | null;
  grade?: string | null;
  grading_fees?: number | string;
  acquisition_fees?: number | string;
}

const CARD_CONDITIONS = ["Near Mint", "Lightly Played", "Moderately Played", "Heavily Played", "Damaged"];
const GRADERS = ["None", "PSA", "BGS", "CGC", "SGC", "TAG", "Other"];

export function LotForm({
  type,
  defaults,
  itemLabel,
}: {
  type: "sealed" | "card";
  defaults: LotDefaults;
  /** Name of the selected catalog item; null for a custom entry. */
  itemLabel: string | null;
}) {
  const [state, action, pending] = useActionState<LotFormState, FormData>(saveLot.bind(null, type), {});
  const e = state.fieldErrors ?? {};
  const s = (v: unknown) => (v === null || v === undefined ? undefined : String(v));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {defaults.id ? <input type="hidden" name="id" value={defaults.id} /> : null}
      {defaults.item_id ? <input type="hidden" name="item_id" value={defaults.item_id} /> : null}

      {itemLabel ? (
        <div className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
          <span className="text-muted">{type === "sealed" ? "Product" : "Card"}:</span> <span className="font-medium">{itemLabel}</span>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Item name" htmlFor="custom_name" error={e.custom_name} hint="Custom entry, not linked to the catalog.">
            <Input id="custom_name" name="custom_name" defaultValue={s(defaults.custom_name)} required maxLength={200} />
          </Field>
          <Field label="Set (optional)" htmlFor="custom_set_name">
            <Input id="custom_set_name" name="custom_set_name" defaultValue={s(defaults.custom_set_name)} maxLength={200} />
          </Field>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Quantity" htmlFor="quantity" error={e.quantity}>
          <Input id="quantity" name="quantity" type="number" min={1} step={1} defaultValue={defaults.quantity ?? 1} required />
        </Field>
        <Field label={type === "sealed" ? "Price per unit" : "Price per copy"} htmlFor="purchase_price_per_unit" error={e.purchase_price_per_unit}>
          <Input id="purchase_price_per_unit" name="purchase_price_per_unit" inputMode="decimal" defaultValue={s(defaults.purchase_price_per_unit)} placeholder="0.00" required />
        </Field>
        <Field label="Currency" htmlFor="currency" error={e.currency}>
          <Input id="currency" name="currency" defaultValue={defaults.currency ?? "USD"} maxLength={3} />
        </Field>
        <Field label="Purchase date" htmlFor="purchase_date" error={e.purchase_date}>
          <Input id="purchase_date" name="purchase_date" type="date" max={today} defaultValue={s(defaults.purchase_date)} />
        </Field>
      </div>

      {type === "sealed" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Fees (total for this lot)" htmlFor="fees" error={e.fees} hint="Added to cost basis.">
              <Input id="fees" name="fees" inputMode="decimal" defaultValue={s(defaults.fees) ?? "0"} />
            </Field>
            <Field label="Shipping (total for this lot)" htmlFor="shipping" error={e.shipping} hint="Added to cost basis.">
              <Input id="shipping" name="shipping" inputMode="decimal" defaultValue={s(defaults.shipping) ?? "0"} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Condition (optional)" htmlFor="condition">
              <Input id="condition" name="condition" list="sealed-conditions" defaultValue={s(defaults.condition)} maxLength={60} />
              <datalist id="sealed-conditions">
                <option value="Factory sealed" />
                <option value="Sealed, minor box wear" />
                <option value="Sealed, damaged box" />
              </datalist>
            </Field>
            <Field label="Storage location (optional)" htmlFor="storage_location">
              <Input id="storage_location" name="storage_location" defaultValue={s(defaults.storage_location)} maxLength={200} />
            </Field>
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Condition" htmlFor="condition">
              <Select id="condition" name="condition" defaultValue={defaults.condition ?? "Near Mint"}>
                {CARD_CONDITIONS.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Language" htmlFor="language">
              <Input id="language" name="language" defaultValue={defaults.language ?? "English"} maxLength={40} />
            </Field>
            <Field label="Grading company" htmlFor="grading_company">
              <Select id="grading_company" name="grading_company" defaultValue={defaults.grading_company ?? "None"}>
                {GRADERS.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </Select>
            </Field>
            <Field label="Grade" htmlFor="grade" error={e.grade}>
              <Input id="grade" name="grade" defaultValue={s(defaults.grade)} maxLength={20} placeholder="e.g. 10" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Grading fees (total)" htmlFor="grading_fees" error={e.grading_fees} hint="Added to cost basis.">
              <Input id="grading_fees" name="grading_fees" inputMode="decimal" defaultValue={s(defaults.grading_fees) ?? "0"} />
            </Field>
            <Field label="Acquisition fees and shipping (total)" htmlFor="acquisition_fees" error={e.acquisition_fees} hint="Added to cost basis.">
              <Input id="acquisition_fees" name="acquisition_fees" inputMode="decimal" defaultValue={s(defaults.acquisition_fees) ?? "0"} />
            </Field>
          </div>
        </>
      )}

      <Field
        label="Your valuation per unit (optional)"
        htmlFor="manual_unit_value"
        error={e.manual_unit_value}
        hint={
          itemLabel
            ? "Overrides the market price for this lot and is labelled “Manual”. Useful for graded cards, which are otherwise valued at the ungraded price."
            : "Custom items have no market price; enter one to include this lot in your collection value."
        }
      >
        <Input id="manual_unit_value" name="manual_unit_value" inputMode="decimal" defaultValue={s(defaults.manual_unit_value)} placeholder="Leave blank to use the market price" />
      </Field>
      <Field label="Notes (optional)" htmlFor="notes">
        <Textarea id="notes" name="notes" defaultValue={s(defaults.notes)} maxLength={2000} />
      </Field>

      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : defaults.id ? "Save changes" : "Add to collection"}
        </Button>
        <Button asChild variant="ghost">
          <Link href="/collection">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
