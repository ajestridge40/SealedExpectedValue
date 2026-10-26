"use client";

import { useActionState } from "react";
import { setManualPrice } from "@/app/actions/admin";
import type { FormState } from "@/app/actions/auth";
import { Notice } from "./page";
import { Button } from "./ui/button";
import { Field, Input } from "./ui/form";

/** Admin-only: record a manually observed price (stored as source_kind = manual). */
export function ManualPriceForm({ kind, id, path }: { kind: "sealed" | "card"; id: string; path: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setManualPrice, {});
  const today = new Date().toISOString().slice(0, 10);
  return (
    <form action={action} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="path" value={path} />
      <Field label="Market price" htmlFor="mp-price">
        <Input id="mp-price" name="price" inputMode="decimal" required placeholder="0.00" />
      </Field>
      <Field label="Currency" htmlFor="mp-currency">
        <Input id="mp-currency" name="currency" defaultValue="USD" maxLength={3} />
      </Field>
      <Field label="Observed on" htmlFor="mp-asof">
        <Input id="mp-asof" name="as_of" type="date" defaultValue={today} max={today} required />
      </Field>
      <Field label="Source note" htmlFor="mp-note">
        <Input id="mp-note" name="note" maxLength={500} placeholder="e.g. local game store" />
      </Field>
      <div className="col-span-2 flex items-center gap-3 sm:col-span-4">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save manual price"}
        </Button>
        {state.error ? <Notice tone="error">{state.error}</Notice> : null}
        {state.message ? <Notice tone="success">{state.message}</Notice> : null}
      </div>
    </form>
  );
}
