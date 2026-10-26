import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { DISCLAIMER } from "@/components/page";
import { SetupRequired } from "@/components/setup-required";
import { SiteHeader } from "@/components/site-header";
import { publicEnv } from "@/lib/env";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "SealedEV — Sealed TCG expected value tracker", template: "%s · SealedEV" },
  description:
    "Research sealed trading card products, estimate the expected value of opening them, and track your collection's market value.",
};

export const viewport: Viewport = { themeColor: "#0a0d14", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const configured = publicEnv() !== null;
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="focus:bg-accent focus:text-accent-fg sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        {configured ? <SiteHeader /> : null}
        <main id="main" className="mx-auto w-full max-w-7xl min-w-0 flex-1 px-4 py-6 sm:py-8">
          {configured ? children : <SetupRequired />}
        </main>
        <footer className="border-border border-t">
          <div className="text-subtle mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-xs">
            <p>{DISCLAIMER}</p>
            <p>
              Prices: TCGplayer market prices via{" "}
              <a className="hover:text-muted underline" href="https://tcgapi.dev" rel="noreferrer">
                TCG API
              </a>{" "}
              unless marked as imported or manual. Pull rates are community estimates unless labelled official. Not
              affiliated with TCGplayer, The Pokémon Company, Wizards of the Coast or Konami.{" "}
              <Link className="hover:text-muted underline" href="/methodology">
                Methodology
              </Link>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
