import { SearchX } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/page";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <EmptyState icon={SearchX} title="Page not found" action={<Button asChild variant="primary"><Link href="/products">Browse products</Link></Button>}>
      That product, card or page doesn&apos;t exist.
    </EmptyState>
  );
}
