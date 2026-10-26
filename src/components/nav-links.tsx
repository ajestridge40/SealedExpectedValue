"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/products", label: "Sealed" },
  { href: "/compare", label: "Compare" },
  { href: "/cards", label: "Cards" },
  { href: "/collection", label: "Collection" },
  { href: "/watchlist", label: "Watchlist" },
];

export function NavLinks({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className={cn("flex items-center gap-1", className)}>
      {NAV.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
              active ? "bg-surface-3 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
