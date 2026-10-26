"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/actions/auth";
import { deleteAccount, updateProfile } from "@/app/actions/settings";
import { Notice } from "./page";
import { Button } from "./ui/button";
import { Field, Input, Select } from "./ui/form";

export function ProfileForm({
  profile,
  games,
}: {
  profile: {
    display_name: string | null;
    default_currency: string;
    preferred_game_id: string | null;
    price_stale_after_hours: number;
  };
  games: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateProfile, {});
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <Field label="Display name" htmlFor="display_name">
        <Input id="display_name" name="display_name" defaultValue={profile.display_name ?? ""} maxLength={80} />
      </Field>
      <Field
        label="Default currency"
        htmlFor="default_currency"
        hint="Used for new lots and collection totals. Prices are not converted between currencies."
      >
        <Input id="default_currency" name="default_currency" defaultValue={profile.default_currency} maxLength={3} />
      </Field>
      <Field label="Preferred TCG" htmlFor="preferred_game_id" hint="Pre-selected in the explorers.">
        <Select id="preferred_game_id" name="preferred_game_id" defaultValue={profile.preferred_game_id ?? ""}>
          <option value="">No preference</option>
          {games.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Treat prices as stale after"
        htmlFor="price_stale_after_hours"
        hint="Prices refresh once a day; older prices are flagged."
      >
        <Select
          id="price_stale_after_hours"
          name="price_stale_after_hours"
          defaultValue={String(profile.price_stale_after_hours)}
        >
          <option value="24">24 hours</option>
          <option value="48">48 hours</option>
          <option value="72">3 days</option>
          <option value="168">7 days</option>
          <option value="720">30 days</option>
        </Select>
      </Field>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
        {state.error ? <Notice tone="error">{state.error}</Notice> : null}
        {state.message ? <Notice tone="success">{state.message}</Notice> : null}
      </div>
    </form>
  );
}

export function DeleteAccountForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(deleteAccount, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <p className="text-muted text-sm">
        This permanently deletes your account, collection lots, watchlist and settings. It cannot be undone. Export your
        data first if you want a copy.
      </p>
      <Field label='Type "DELETE" to confirm' htmlFor="confirm">
        <Input id="confirm" name="confirm" autoComplete="off" className="max-w-xs" />
      </Field>
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <Button type="submit" variant="danger" className="self-start" disabled={pending}>
        {pending ? "Deleting…" : "Delete my account"}
      </Button>
    </form>
  );
}
