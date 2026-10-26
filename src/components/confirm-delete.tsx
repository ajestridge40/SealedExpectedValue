"use client";

import { Trash2 } from "lucide-react";
import { AlertDialog } from "radix-ui";
import { Button } from "./ui/button";

/** Destructive action behind a confirmation dialog. Submits a server-action form. */
export function ConfirmDelete({
  action,
  fields,
  title,
  description,
  label = "Delete",
  confirmLabel = "Delete",
  size = "sm",
}: {
  action: (formData: FormData) => void | Promise<void>;
  fields: Record<string, string>;
  title: string;
  description: string;
  label?: string;
  confirmLabel?: string;
  size?: "sm" | "md" | "icon";
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>
        <Button
          variant="ghost"
          size={size}
          aria-label={size === "icon" ? label : undefined}
          className="text-muted hover:text-loss"
        >
          <Trash2 /> {size === "icon" ? null : label}
        </Button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <AlertDialog.Content className="border-border-strong bg-surface fixed top-1/2 left-1/2 z-50 w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border p-5 shadow-xl">
          <AlertDialog.Title className="text-base font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="text-muted mt-2 text-sm">{description}</AlertDialog.Description>
          <form action={action} className="mt-5 flex justify-end gap-2">
            {Object.entries(fields).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <AlertDialog.Cancel asChild>
              <Button type="button">Cancel</Button>
            </AlertDialog.Cancel>
            <Button type="submit" variant="danger">
              {confirmLabel}
            </Button>
          </form>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
