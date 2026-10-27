import Link from "next/link";
import { Button } from "./ui/button";

/** Previous/next links that keep the current query string. */
export function Pagination({
  page,
  pages,
  params,
}: {
  page: number;
  pages: number;
  params: Record<string, string | string[] | undefined>;
}) {
  if (pages <= 1) return null;
  const href = (p: number) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (k === "page" || v === undefined) continue;
      for (const item of [v].flat()) if (item) u.append(k, item);
    }
    u.set("page", String(p));
    return `?${u}`;
  };
  return (
    <nav aria-label="Pagination" className="mt-6 flex items-center justify-center gap-2 text-sm">
      {page > 1 ? (
        <Button asChild size="sm">
          <Link href={href(page - 1)}>Previous</Link>
        </Button>
      ) : null}
      <span className="text-muted">
        Page {page.toLocaleString()} of {pages.toLocaleString()}
      </span>
      {page < pages ? (
        <Button asChild size="sm">
          <Link href={href(page + 1)}>Next</Link>
        </Button>
      ) : null}
    </nav>
  );
}
