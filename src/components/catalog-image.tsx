"use client";

import { ImageOff } from "lucide-react";
import { useState } from "react";
import { safeImageUrl } from "@/lib/pricing/types";
import { cn } from "@/lib/utils";

/**
 * Product/card image from an allow-listed CDN, with a consistent placeholder
 * when the URL is missing, not allow-listed, or fails to load.
 */
export function CatalogImage({
  src,
  alt,
  className,
  aspect = "card",
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  aspect?: "card" | "square";
}) {
  const safe = safeImageUrl(src);
  const [failed, setFailed] = useState(false);
  const box = cn(
    "relative overflow-hidden rounded-md bg-surface-2",
    aspect === "card" ? "aspect-[5/7]" : "aspect-square",
    className,
  );
  if (!safe || failed) {
    return (
      <div
        className={cn(
          box,
          "border-border-strong text-subtle @container flex flex-col items-center justify-center gap-1 border border-dashed",
        )}
      >
        <ImageOff className="size-4" aria-hidden />
        <span className="text-[10px] [@container(max-width:64px)]:hidden">No image</span>
        <span className="sr-only">{alt}</span>
      </div>
    );
  }
  return (
    <div className={box}>
      {/* eslint-disable-next-line @next/next/no-img-element -- served from the source CDN, see next.config.ts */}
      <img
        src={safe}
        alt={alt}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="size-full object-contain"
      />
    </div>
  );
}
