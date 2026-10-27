# SealedEV — sealed TCG expected value and collection tracker

SealedEV helps you research sealed trading card products and track a collection:

- **Sealed product explorer**: market price, estimated expected value (EV) of opening, EV-to-price ratio, estimated net
  return, confidence and price freshness, with filters, sorting and a side-by-side comparison view.
- **Product pages**: price history, the full EV calculation broken down by slot and outcome, the five most valuable
  pulls with their odds, sourced pull rates, and a scenario calculator for your own purchase price.
- **Card explorer**: single-card prices and history, no account needed.
- **Collection**: sealed and card acquisition lots with fees, shipping, grading and condition; cost basis per lot,
  market value, unrealized gain/loss, CSV export.
- **Watchlist, settings, data export and account deletion.**

Pokémon is the first supported game. Magic: The Gathering and Yu-Gi-Oh! are in the data model (and in TCGTracking's
catalog), along with One Piece, Disney Lorcana, Star Wars: Unlimited and Riftbound; adding a set and a pull model is data entry, not code.

> **Honesty rules.** No price, image or pull rate in this repository is invented. The seed contains real products and
> sourced **community** pull-rate estimates, but no prices: prices come only from the pricing provider, a CSV import or
> manual entry, and each is labelled with its source and timestamp. When the data cannot support an EV, the app shows
> “Insufficient pull-rate data” instead of a number. See [docs/EV_METHODOLOGY.md](docs/EV_METHODOLOGY.md).

## Stack

Next.js 16 (App Router, React 19, TypeScript) · Tailwind CSS v4 with shadcn-style components · Supabase (PostgreSQL,
Auth, Row Level Security) · Zod · decimal.js · Recharts · Vitest. One deployable app; no separate server, queue, cache
or Docker required.

```
src/lib/ev/          EV engine (pure, tested): engine, confidence, returns, DB→model mapping
src/lib/portfolio/   lot valuation, positions, portfolio totals (pure, tested)
src/lib/pricing/     provider interface, TCGTracking + optional pokemontcg.io providers, refresh job, CSV import
src/lib/catalog/     catalog import, “sync latest sets”, strict name matching
src/lib/analytics/   market signals: momentum, volatility, listing spread, top-5 ratio
src/lib/data/        server-side queries (Supabase, RLS applies)
src/app/             pages, server actions (app/actions), API routes (cron, exports)
supabase/            migrations (schema, RLS), seed.sql, CLI config
scripts/             catalog import, price refresh, make-admin CLIs
tests/db/            migration + RLS integration tests against PostgreSQL
```

## Pricing data: what is integrated and why

| Source                                                                | Used for                                                                    | Key                             | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[TCGTracking Open API](https://tcgtracking.com/tcgapi/)** (primary) | Sealed **and** single-card prices (every printing), catalog, product images | None                            | Free, no key, CDN-cached TCGplayer market prices for 55+ games. Three requests per set: set list, products, pricing (`/v1/{category}/sets`, `/sets/{id}`, `/sets/{id}/pricing`). USD market and low prices per printing. TCGTracking announced a move from `tcgtracking.com/tcgapi` to `openapi.tcgtracking.com`; SealedEV tries the new host first and falls back to the old one (override with `TCGTRACKING_BASE_URL`). No published SLA. |
| [Pokémon TCG API](https://pokemontcg.io) (optional)                   | Pokémon card prices for cards linked by `pokemontcg_id` only                | Optional (`POKEMONTCG_API_KEY`) | Card metadata/images with TCGplayer-derived prices and an update date. No sealed products. Rate limits without a key are low (reported around 1,000 requests/day); a free key raises them. Disabled by default (`ENABLE_POKEMONTCG=1`).                                                                                                                                                                                                     |
| CSV import / manual entry                                             | Anything else                                                               | —                               | Admin-only. Stored and displayed as “CSV import” / “Manual”, never as live data.                                                                                                                                                                                                                                                                                                                                                            |

Market analytics (set stats, 7-day movers, momentum, volatility, listing spread) are computed from the stored prices; see
“Market analytics” below.

Why not others: **TCGplayer's official API is closed to new developers** (its docs state no new API access is being
granted). eBay sold-listing data needs restricted API access; Cardmarket's API requires approval. Scraping is not used.
Provider responses are validated with Zod, normalized into internal types (`src/lib/pricing/types.ts`), and stored as
`price_snapshots`; pages never call a provider while rendering. A new provider implements `PricingProvider`
(`searchProducts`, `getProductDetails`, `getCurrentProductPrice`, `searchCards`, `getCardDetails`,
`getCurrentCardPrice`, optional `getPriceHistory`). Neither integrated provider offers price history, so history is
built from SealedEV's own daily snapshots.

**Card, product and set images** are hot-linked from the provider's CDN (mostly `tcgplayer-cdn.tcgplayer.com`), not
downloaded or re-hosted. Only plain `https` URLs that come from the provider are stored (`safeImageUrl` in
`src/lib/pricing/types.ts`); missing or broken images show a placeholder.

## Market analytics

Computed from stored prices, with no extra API calls:

- **Top-5 cards / price**: the set's five most valuable cards ÷ the product's price. A quick set-strength indicator for
  products without a pull-rate model. It is **not** an EV and is always labelled as such.
- **Set stats** (materialized view `set_stats`, refreshed after each price refresh): cards worth ≥ $10 / ≥ $25
  (chase) / ≥ $50, alt-art and chase-rarity counts, top-5 value, top card, booster box price and cover image.
- **Price movers** (database function `sealed_price_changes(days)`): change versus the latest price at least N days old.
- **Product signals**: 30/90-day change, 30-day volatility (standard deviation ÷ mean), listing spread
  ((market − lowest listing) ÷ market, a rough liquidity signal) and set age.

The dashboard shows EV / price (or top-5 / price when few products have pull models) by product with a 1.0× break-even
line, price vs value with a y = x line, the biggest 7-day drops, and the strongest sets by booster box.

## Prerequisites

- **Node.js 22 LTS** (22.9 or newer; 24 LTS also works) from [nodejs.org](https://nodejs.org) — includes npm
- **Git** ([git-scm.com](https://git-scm.com))
- A free **Supabase** project ([supabase.com](https://supabase.com)) — no Docker or Postgres install needed

## Run it locally (Windows PowerShell)

These commands work in Windows PowerShell 5.1, PowerShell 7, cmd and macOS/Linux shells. Run them one per line.

**1. Get the code and install dependencies**

```powershell
git clone -b claude/funny-ramanujan-778slt https://github.com/ajestridge40/SealedExpectedValue.git
cd SealedExpectedValue
npm install
```

> If PowerShell says _“running scripts is disabled on this system”_ when you run `npm`, allow locally created
> scripts once with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (or type `npm.cmd` instead of `npm`).

**2. Create a Supabase project** at [supabase.com/dashboard](https://supabase.com/dashboard) (free plan, pick a database
password and keep it). When it has finished provisioning, gather four values:

| Value                                                     | Where in the Supabase dashboard                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Project URL                                               | **Project Settings → Data API** (looks like `https://abcdefgh.supabase.co`)                                        |
| Publishable key (`sb_publishable_…`) or legacy `anon` key | **Project Settings → API Keys**                                                                                    |
| Secret key (`sb_secret_…`) or legacy `service_role` key   | **Project Settings → API Keys** (keep it private)                                                                  |
| Connection string                                         | **Connect** button (top bar) → **Session pooler** → URI, with `[YOUR-PASSWORD]` replaced by your database password |

Use the **Session pooler** string: the “Direct connection” host is IPv6-only and fails on many home networks.

**3. Run the setup wizard**

```powershell
npm run setup
```

It asks for the four values, writes `.env.local` (git-ignored), creates the tables, Row Level Security policies and
seed data, then imports the catalog (sets, sealed products, every card, images) and today's prices from TCGTracking. It then offers to add the latest sets of any games you choose. Re-running
it is safe; delete `.env.local` first if you want to re-enter keys.

**4. Allow local sign-in links.** In Supabase → **Authentication → URL Configuration**, set **Site URL** to
`http://localhost:3000` and add `http://localhost:3000/auth/callback` under **Redirect URLs**. For quick local testing
you can instead turn off **Confirm email** (Authentication → Sign In / Providers → Email).

**5. Start the app**

```powershell
npm run dev
```

Open http://localhost:3000, sign up, then make your account an admin (unlocks `/admin`: import, refresh, CSV prices,
manual prices):

```powershell
npm run user:make-admin you@example.com
```

Day to day: `npm run dev` to run the app, `npm run prices:refresh` to pull the latest prices (prices change about once a
day), `npm run catalog:import` after adding sets or products, and `npm run catalog:sync pokemon,lorcana 15` to add the
latest 15 sets of those games (games: `pokemon`, `one-piece`, `lorcana`, `star-wars-unlimited`, `riftbound`, `mtg`,
`yugioh`, or `all`). Admins can do the same from `/admin` → “Sync sets”.

### The full catalog: every product of every game

SealedEV can store every set, sealed product and card printing (with images and prices) of every game TCGTracking
covers, so all users read prices from your database and nothing calls the API while pages render:

```powershell
npm run catalog:sync:all          # booster boxes + top 25 cards of every set of every game (fast)
npm run catalog:sync:full         # everything: every sealed product and card printing (hours)
```

`catalog:sync:all` adds only **booster boxes** and each set's **25 most valuable cards** (with images, set logos and
prices), and skips sets that have no booster box. The card data comes in the same download as the box, so it finishes in
a fraction of the full load's time and uses little space, and every box still gets its **top-5 card value ÷ price**
and set stats (chase cards, top card). Past the top 25 a set's cards rarely matter for a box's value. Set stats then
count only the stored cards, and the top 25 is re-checked when the weekly sync reloads the set. Every card of chosen
games: `npm run catalog:sync pokemon 0 force`; everything: `catalog:sync:full`. EV (from pull rates) still needs a
pull-rate model per product; see `docs/EV_METHODOLOGY.md`.

- **Resumable.** Each set is saved as soon as it is loaded, and sets loaded in the last 7 days are skipped, so you can
  stop it (Ctrl+C) and run the same command again to continue. Add `force` (`npm run catalog:sync all 0 force`) to
  reload everything.
- **Time and size.** The first full load makes three requests per set (several thousand sets) and takes a few hours.
  Expect **roughly 1 million card printings and a few GB** of database space, more as price history grows. Supabase's
  free plan stops at 500 MB, so the full catalog needs the **Pro plan** (8 GB included). On the free plan, sync only the
  games you care about (for example `npm run catalog:sync pokemon,one-piece,lorcana 0`).
- **Small history.** Sealed products get a price row every day (for charts); cards get a new history row only when
  their price changes.
- **Precomputed.** After each run, set stats (`set_stats`), 7/30-day price changes and EV results (`product_ev`) are
  recomputed in the database, so list pages filter, sort and paginate in SQL.
- **Keeping it fresh.** `npm run prices:refresh` refreshes every set whose prices are more than 12 hours old (oldest
  first; also resumable). For a hosted site use the GitHub Actions below, since a full refresh runs longer than a Vercel
  function may.

**Set images.** Sets show their logo and symbol from TCGTracking when it provides them; otherwise the set's booster box
image, then its most valuable card. Browse them at `/sets`.

### Scheduled refresh with GitHub Actions (recommended for the full catalog)

Two workflows in `.github/workflows` run on GitHub's servers (free for public repositories; private repositories
include 2,000 minutes a month):

- **Refresh prices** (`refresh-prices.yml`): daily at 07:17 UTC.
- **Sync catalog** (`catalog-sync.yml`): Mondays, adds the booster boxes of new sets of every game. Run it by hand the first
  time (GitHub → **Actions** → **Sync catalog** → **Run workflow**; untick “Booster boxes and top cards only” for everything) to load the catalog without keeping your
  computer on. Long first loads continue on the next run.

Add two repository secrets (GitHub → **Settings** → **Secrets and variables** → **Actions** → **New repository
secret**): `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (your Supabase secret key). Never commit them.

If the import lists items under “needs attention” (no exact TCGplayer name match), set `sets.tcgplayer_group_id` or
`sealed_products.tcgplayer_product_id` in the Supabase **Table Editor** (the id is the number in
`tcgplayer.com/product/<id>`) and run `npm run catalog:import` again.

### Other ways to set up the database

- `npm run db:setup` — apply any pending migrations, then the seed (safe to repeat), using `DATABASE_URL` from `.env.local`. Applied migrations are recorded in the same table the Supabase CLI uses.
- `npm run db:seed` — re-run only the (idempotent) seed.
- Supabase CLI: `npx supabase link --project-ref <ref>` then `npx supabase db push --include-seed`.
- By hand: paste `supabase/migrations/20261026000000_init.sql`, then `supabase/seed.sql`, into the Supabase SQL editor.
- Fully local Supabase in Docker: `npx supabase start`, then `npx supabase db reset`, and put the printed URL and keys in
  `.env.local` (plus `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`).

### Admin access

Admins can run the import/refresh from `/admin`, upload price CSVs and record manual prices. Sign up in the app, then:

```bash
npm run user:make-admin you@example.com
```

`profiles.is_admin` cannot be changed by users themselves (column privileges + RLS).

## Environment variables

| Variable                                                                                | Where           | Purpose                                                          |
| --------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`                                                              | public          | Supabase project URL                                             |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`)             | public          | Publishable/anon key                                             |
| `NEXT_PUBLIC_SITE_URL`                                                                  | public          | Canonical URL for auth emails and OAuth redirects                |
| `NEXT_PUBLIC_ENABLE_GOOGLE_AUTH`                                                        | public          | `1` to show “Continue with Google”                               |
| `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`)                                  | **server only** | Scheduled refresh, catalog import, CLI scripts, account deletion |
| `CRON_SECRET`                                                                           | **server only** | Bearer token required by `/api/cron/refresh-prices`              |
| `ENABLE_TCGTRACKING`, `TCGTRACKING_BASE_URL`, `ENABLE_POKEMONTCG`, `POKEMONTCG_API_KEY` | server only     | Provider switches, host override, optional key                   |
| `PRICE_REFRESH_MIN_INTERVAL_HOURS`                                                      | server only     | Minimum gap between scheduled refreshes (default 12)             |
| `DATABASE_URL`                                                                          | CLI only        | `npm run setup`, `db:setup`, `db:seed` (Session pooler string)   |

**Public vs. secret keys.** `NEXT_PUBLIC_*` values are compiled into the browser bundle. The Supabase URL and
publishable/anon key are designed to be public: every table has Row Level Security, so the anon key can only read the
public catalog and the signed-in user's own rows. The **service-role key bypasses RLS**. It is read only in server code
(`src/lib/supabase/admin.ts`, marked `server-only`) and in CLI scripts; never give it a `NEXT_PUBLIC_` prefix, never log
it, never commit it. `.env*` files are git-ignored except `.env.example`.

## Authentication

Email/password sign-up and sign-in, password reset and sign-out work out of the box with Supabase Auth.

- **Site URL / redirects**: in Supabase **Authentication → URL Configuration**, set the Site URL to your deployed URL and
  add `https://<your-domain>/auth/callback` (and `http://localhost:3000/auth/callback` for development) to the
  redirect allow list. Email confirmation and password-reset links land on `/auth/callback`.
- **Email confirmation** is on by default for hosted projects; new users confirm before signing in. Supabase's built-in
  email sender is rate-limited; configure custom SMTP for production.
- **Google (optional)**: create an OAuth client in Google Cloud, enable the Google provider in Supabase with its client
  id/secret, add Supabase's callback URL to the Google client, then set `NEXT_PUBLIC_ENABLE_GOOGLE_AUTH=1`.

## Database

Schema: `supabase/migrations/20261026000000_init.sql`. Main tables: `profiles`, `games`, `sets`, `sealed_products`,
`cards` (one row per printing), `price_snapshots`, `product_pull_models`, `pull_model_slots`, `pull_rate_estimates`,
`collection_sealed_positions` and `collection_card_positions` (one row per **acquisition lot**), `watchlist_items`,
`data_sources`, `job_runs`.

- Money is `numeric(12,2)` with an explicit ISO currency column; TypeScript uses decimal.js, never floats.
- `price_snapshots` is unique per item, source and day, so re-running a refresh updates instead of duplicating. A trigger
  keeps `current_price`/`price_updated_at` on products and cards pointing at the newest snapshot.
- Full-catalog support (`20261029000000_full_catalog.sql`): `product_overview` and `set_overview` views (one row per
  product / set with everything the list pages need), `product_ev` (EV results stored by the refresh job), the
  materialized `set_stats`, stored 7/30-day price changes, and trigram indexes for name search.
- RLS: catalog, prices and pull models are readable by everyone and writable only by admins (or the service role).
  Profiles, collection lots and watchlists are readable and writable only by their owner. `job_runs` is service-role
  only (admins can read). Deleting an auth user cascades to all of their data.

## Tests and checks

```bash
npm test             # unit tests (EV engine, portfolio, pricing providers with mocked responses, CSV) + DB tests if configured
npm run test:db      # migration + RLS integration tests; needs DATABASE_TEST_URL
npm run lint
npm run typecheck
npm run format:check
npm run check        # all of the above except the build
npm run build
```

The database tests apply the real migration and seed to a scratch PostgreSQL database (with a tiny Supabase shim for
`auth.uid()` and the `anon`/`authenticated` roles) and verify that users cannot read, modify or delete each other's
lots, cannot make themselves admin, cannot write catalog data, and that account deletion removes their data:

```bash
DATABASE_TEST_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:db
# PowerShell: $env:DATABASE_TEST_URL = "postgres://postgres:postgres@localhost:5432/postgres"; npm run test:db
```

CI (`.github/workflows/ci.yml`) runs formatting, lint, type check, all tests (with a PostgreSQL service) and the build.

## Production build

```bash
npm run build
npm start
```

## Deploying to Vercel (default)

1. Push the repository to GitHub and import it in Vercel (framework: Next.js; no extra settings).
2. Add the environment variables from `.env.example` for Production (and Preview if wanted). Set
   `NEXT_PUBLIC_SITE_URL` to the production URL and generate a long random `CRON_SECRET`.
3. Apply the migrations and seed to your Supabase project (see Local setup, Option A), and add the production
   `/auth/callback` URL to Supabase's redirect allow list.
4. Deploy. Then load the catalog once: `npm run catalog:sync:all` from your machine with the production env vars, or
   the **Sync catalog** GitHub Action (see “The full catalog” above).

**Scheduled refresh.** `vercel.json` defines a daily cron at 21:15 UTC (prices change about once a day) that calls
`/api/cron/refresh-prices`; Vercel sends `Authorization: Bearer $CRON_SECRET` automatically. On the Hobby plan cron jobs
run at most once a day and may fire any time within the scheduled hour. Each call refreshes the sets with the oldest
prices for up to about 4 minutes, which covers a few hundred sets; **with the full catalog use the GitHub Actions
workflow** instead (or as well).
Overlapping runs are prevented by a database lock (`start_job`), and runs within `PRICE_REFRESH_MIN_INTERVAL_HOURS` of
the last success are skipped unless `?force=1`.

Manual trigger (PowerShell):
`Invoke-RestMethod -Headers @{ Authorization = "Bearer <CRON_SECRET>" } "https://<your-domain>/api/cron/refresh-prices?force=1"`
(bash: `curl -H "Authorization: Bearer $CRON_SECRET" "https://<your-domain>/api/cron/refresh-prices?force=1"`).

## AWS (alternative)

The app is a standard Next.js server app; the database stays on Supabase.

- **AWS Amplify Hosting** supports Next.js SSR. `amplify.yml` is included: connect the repo, add the environment
  variables in the Amplify console (it writes the server-only ones to `.env.production` at build time so the SSR
  runtime can read them), and deploy.
- **Scheduler**: Amplify has no built-in cron. Use **Amazon EventBridge Scheduler** with an HTTPS target (an API
  destination) that calls `GET /api/cron/refresh-prices` daily with the header `Authorization: Bearer <CRON_SECRET>`.
  Any external scheduler (GitHub Actions `schedule`, cron-job.org) works the same way.
- Other options (ECS/Fargate, App Runner with `next start`) work too but add infrastructure you then maintain.

## Backups and recovery

- **Supabase**: paid plans include daily backups, with point-in-time recovery as an add-on; free projects do not include
  downloadable backups and are paused after a period of inactivity. Check Supabase's current plan details.
- Independent of plan, take periodic logical backups:
  ```bash
  npx supabase db dump --linked -f backup-schema.sql
  npx supabase db dump --linked --data-only -f backup-data.sql
  # or: pg_dump "$DATABASE_URL" -Fc -f sealedev.dump
  ```
  Restore with `psql`/`pg_restore` into a fresh project after applying the migrations.
- The catalog and prices can always be rebuilt from TCGTracking (`catalog:import` + `prices:refresh`), but **price history
  before the restore point and user collections cannot**, so back up the database itself.
- Users can download their own data from Settings (collection CSV and full JSON export).

## Known limitations and pricing caveats

- **Prices are TCGplayer market prices (US, USD)**, updated once a day. They describe recent near-mint sales of ungraded
  cards on one marketplace, not what you will net after fees and shipping. Graded cards are valued at the ungraded
  price unless you enter your own valuation.
- No currency conversion. Lots and prices in other currencies are kept separate and flagged, never converted.
- TCGTracking is a free community service with no SLA. If it is down, the refresh fails, the error is recorded, and the last
  known prices stay in place with their original timestamps (shown as stale once old).
- Price history starts from your first refresh; earlier history is not back-filled.
- **Pull rates**: The Pokémon Company publishes no odds. Seeded rates are community estimates with sample sizes and
  links; small samples (e.g. Prismatic Evolutions, ~1,200 packs) carry wide uncertainty. Confidence labels are
  documented heuristics, not statistical guarantees.
- Rarity-level rates assume every card of a rarity is equally likely.
- Catalog matching is by exact name; new sets/products may need their TCGplayer ids set by hand once.
- **EV is an average, not a forecast.** Most individual boxes return well below or above it, and opening sealed product
  can lose a large share of the purchase price. Nothing in this app is financial advice.

## Adding a game, set or product

1. Insert the game (with its TCGplayer category id) if needed, then the set and its sealed products (see `seed.sql`).
2. `npm run catalog:import` to link ids and import the set's cards; `npm run prices:refresh:force`.
3. Add a pull model: one `product_pull_models` row, its slots and `pull_rate_estimates`, each with an honest
   `source_type`, source name/URL, sample size and verification date. Use `probability = null` for unknown rates rather
   than guessing. `seed.sql` shows complete examples.
