import { LogIn, Settings, Shield } from "lucide-react";
import Link from "next/link";
import { signOut } from "@/app/actions/auth";
import { getProfile, getUser } from "@/lib/auth";
import { NavLinks } from "./nav-links";
import { Button } from "./ui/button";

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight" aria-label="SealedEV home">
      <span
        aria-hidden
        className="grid size-7 place-items-center rounded-md bg-gradient-to-br from-accent to-teal text-[11px] font-bold text-accent-fg"
      >
        EV
      </span>
      <span>
        Sealed<span className="text-accent">EV</span>
      </span>
    </Link>
  );
}

export async function SiteHeader() {
  const user = await getUser();
  const profile = user ? await getProfile() : null;
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
        <Logo />
        <NavLinks className="hidden flex-1 md:flex" />
        <div className="ml-auto flex items-center gap-1">
          {user ? (
            <>
              {profile?.is_admin ? (
                <Button asChild variant="ghost" size="icon" aria-label="Admin">
                  <Link href="/admin">
                    <Shield />
                  </Link>
                </Button>
              ) : null}
              <Button asChild variant="ghost" size="icon" aria-label="Settings">
                <Link href="/settings">
                  <Settings />
                </Link>
              </Button>
              <form action={signOut}>
                <Button variant="ghost" size="sm" type="submit">
                  Sign out
                </Button>
              </form>
            </>
          ) : (
            <Button asChild variant="primary" size="sm">
              <Link href="/login">
                <LogIn /> Sign in
              </Link>
            </Button>
          )}
        </div>
      </div>
      <NavLinks className="overflow-x-auto px-3 pb-2 md:hidden" />
    </header>
  );
}
