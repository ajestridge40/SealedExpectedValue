import { Database } from "lucide-react";
import { EmptyState } from "./page";

export function SetupRequired() {
  return (
    <EmptyState icon={Database} title="Connect a Supabase project to get started">
      <p>
        Set <code className="text-fg">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
        <code className="text-fg">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> (and the server-only{" "}
        <code className="text-fg">SUPABASE_SERVICE_ROLE_KEY</code>) in <code className="text-fg">.env.local</code>,
        apply the migrations, and restart the dev server. See README → Local setup.
      </p>
    </EmptyState>
  );
}
