import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { toggleWatch } from "@/app/actions/watchlist";
import { Button } from "./ui/button";

export function WatchButton({
  kind,
  id,
  path,
  watching,
  signedIn,
}: {
  kind: "sealed" | "card";
  id: string;
  path: string;
  watching: boolean;
  signedIn: boolean;
}) {
  if (!signedIn) {
    return (
      <Button asChild>
        <Link href={`/login?next=${encodeURIComponent(path)}`}>
          <Eye /> Watch
        </Link>
      </Button>
    );
  }
  return (
    <form action={toggleWatch}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="path" value={path} />
      <Button type="submit" aria-pressed={watching}>
        {watching ? <EyeOff /> : <Eye />} {watching ? "Watching" : "Watch"}
      </Button>
    </form>
  );
}
