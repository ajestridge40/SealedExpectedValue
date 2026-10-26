/** Only allow same-site relative paths as post-login destinations. */
export function safeNext(value: unknown, fallback = "/"): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value.slice(0, 300);
}
