"use client";

import { AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/page";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState
      icon={AlertTriangle}
      title="Something went wrong"
      action={<Button onClick={reset}>Try again</Button>}
    >
      The data could not be loaded. If the database or a price provider is temporarily unavailable, the last stored
      prices will be shown once it is reachable again.
      {error.digest ? <p className="mt-2 text-xs text-subtle">Reference: {error.digest}</p> : null}
    </EmptyState>
  );
}
