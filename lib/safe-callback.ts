/**
 * Where to send someone after they sign in.
 *
 * The page they were heading to arrives as `?callbackUrl=`, from the
 * dashboard's session guard or from a link such as "Sign in to download
 * again". It is only ever a path on this site: anything absolute,
 * protocol-relative ("//evil.example") or carrying a backslash or control
 * character falls back to the dashboard, so sign-in can never be used to
 * bounce a buyer to another site.
 *
 * Client-safe and pure.
 */

const FALLBACK = "/dashboard";

export function safeCallbackPath(value: string | null | undefined): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return FALLBACK;
  if (!value.startsWith("/") || value.startsWith("//")) return FALLBACK;
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return FALLBACK;
  return value;
}

/** The callback in this page's own address, or the dashboard. Reads the URL only when called, in the browser. */
export function callbackFromLocation(): string {
  if (typeof window === "undefined") return FALLBACK;
  return safeCallbackPath(new URLSearchParams(window.location.search).get("callbackUrl"));
}
