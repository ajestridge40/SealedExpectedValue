"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { FormState } from "@/app/actions/auth";
import { Notice } from "./page";
import { Button } from "./ui/button";
import { Field, Input } from "./ui/form";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

export function AuthForm({
  action,
  mode,
  next,
}: {
  action: Action;
  mode: "signin" | "signup" | "reset" | "update";
  next?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const submit = { signin: "Sign in", signup: "Create account", reset: "Send reset link", update: "Update password" }[mode];
  return (
    <form action={formAction} className="flex flex-col gap-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {mode !== "update" ? (
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
      ) : null}
      {mode !== "reset" ? (
        <Field
          label={mode === "update" ? "New password" : "Password"}
          htmlFor="password"
          hint={mode === "signup" || mode === "update" ? "At least 8 characters." : undefined}
        >
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            required
            minLength={mode === "signin" ? 1 : 8}
          />
        </Field>
      ) : null}
      {mode === "update" ? (
        <Field label="Confirm new password" htmlFor="confirm">
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} />
        </Field>
      ) : null}
      {mode === "signin" ? (
        <Link href="/forgot-password" className="-mt-2 self-end text-xs text-muted hover:text-fg">
          Forgot password?
        </Link>
      ) : null}
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.message ? <Notice tone="success">{state.message}</Notice> : null}
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Working…" : submit}
      </Button>
    </form>
  );
}
