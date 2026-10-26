"use client";

import { useActionState } from "react";
import { importCatalogNow, importPriceCsv, refreshPricesNow, type CsvImportState } from "@/app/actions/admin";
import type { FormState } from "@/app/actions/auth";
import { Notice } from "./page";
import { Button } from "./ui/button";
import { Input } from "./ui/form";

export function JobButtons() {
  const [refresh, refreshAction, refreshing] = useActionState<FormState, FormData>(refreshPricesNow, {});
  const [imp, importAction, importing] = useActionState<FormState, FormData>(importCatalogNow, {});
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <form action={importAction}>
          <Button type="submit" disabled={importing}>{importing ? "Importing…" : "1. Import / link catalog from TCGCSV"}</Button>
        </form>
        <form action={refreshAction}>
          <Button type="submit" variant="primary" disabled={refreshing}>{refreshing ? "Refreshing…" : "2. Refresh prices now"}</Button>
        </form>
      </div>
      {imp.message ? <Notice tone="success">{imp.message}</Notice> : null}
      {imp.error ? <Notice tone="warn">{imp.error}</Notice> : null}
      {refresh.message ? <Notice tone="success">{refresh.message}</Notice> : null}
      {refresh.error ? <Notice tone="warn">{refresh.error}</Notice> : null}
    </div>
  );
}

export function CsvImportForm() {
  const [state, action, pending] = useActionState<CsvImportState, FormData>(importPriceCsv, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <Input type="file" name="file" accept=".csv,text/csv" required className="h-auto py-1.5" aria-label="Price CSV file" />
      <Button type="submit" className="self-start" disabled={pending}>{pending ? "Importing…" : "Import prices"}</Button>
      {state.message ? <Notice tone="success">{state.message}</Notice> : null}
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.rowErrors?.length ? (
        <details className="text-sm" open>
          <summary className="cursor-pointer text-muted">{state.rowErrors.length} row(s) skipped</summary>
          <ul className="mt-2 max-h-48 overflow-auto text-xs text-muted">
            {state.rowErrors.map((e, i) => (
              <li key={i}>Line {e.line}: {e.message}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </form>
  );
}
