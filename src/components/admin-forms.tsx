"use client";

import { useActionState } from "react";
import {
  importCatalogNow,
  importPriceCsv,
  refreshPricesNow,
  syncLatestSets,
  type CsvImportState,
} from "@/app/actions/admin";
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
          <Button type="submit" disabled={importing}>
            {importing ? "Importing…" : "1. Import / link catalog from TCGTracking"}
          </Button>
        </form>
        <form action={refreshAction}>
          <Button type="submit" variant="primary" disabled={refreshing}>
            {refreshing ? "Refreshing…" : "2. Refresh prices now"}
          </Button>
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
      <Input
        type="file"
        name="file"
        accept=".csv,text/csv"
        required
        className="h-auto py-1.5"
        aria-label="Price CSV file"
      />
      <Button type="submit" className="self-start" disabled={pending}>
        {pending ? "Importing…" : "Import prices"}
      </Button>
      {state.message ? <Notice tone="success">{state.message}</Notice> : null}
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.rowErrors?.length ? (
        <details className="text-sm" open>
          <summary className="text-muted cursor-pointer">{state.rowErrors.length} row(s) skipped</summary>
          <ul className="text-muted mt-2 max-h-48 overflow-auto text-xs">
            {state.rowErrors.map((e, i) => (
              <li key={i}>
                Line {e.line}: {e.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </form>
  );
}

export function SyncSetsForm({ games }: { games: { slug: string; name: string }[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(syncLatestSets, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
        <legend className="text-muted mb-2 text-xs font-medium">Games</legend>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" name="games" value="all" className="accent-[var(--color-accent)]" />
          Every game on TCGTracking
        </label>
        {games.map((g) => (
          <label key={g.slug} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="games"
              value={g.slug}
              defaultChecked={g.slug === "pokemon"}
              className="accent-[var(--color-accent)]"
            />
            {g.name}
          </label>
        ))}
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        Latest
        <Input
          name="maxSets"
          type="number"
          min={0}
          max={10000}
          defaultValue={10}
          className="w-24"
          aria-label="Sets per game"
        />
        sets per game (0 = every set)
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="force" value="1" className="accent-[var(--color-accent)]" />
        Reload sets loaded in the last 7 days
      </label>
      <Button type="submit" className="self-start" disabled={pending}>
        {pending ? "Syncing… (up to 4 minutes per run)" : "Sync sets"}
      </Button>
      {state.message ? <Notice tone="success">{state.message}</Notice> : null}
      {state.error ? <Notice tone="warn">{state.error}</Notice> : null}
    </form>
  );
}
