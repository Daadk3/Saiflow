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

/**
 * A callback as a safe path, or null: a path is checked as it is, and a full
 * address only when it is on `origin` (the dashboard's session guard sends
 * full addresses). Anything else, null.
 */
function toSafePath(value: string | null | undefined, origin: string): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (value.startsWith("/")) return safeCallbackPath(value);
  try {
    const target = new URL(value);
    return target.origin === origin ? safeCallbackPath(`${target.pathname}${target.search}`) : null;
  } catch {
    return null;
  }
}

/**
 * NextAuth's post-sign-in redirect (authOptions `redirect`): back to a page
 * on this site, never to another origin, and the dashboard rather than the
 * bare home page.
 */
export function postSignInUrl(url: string, baseUrl: string): string {
  const path = toSafePath(url, baseUrl) ?? FALLBACK;
  return `${baseUrl}${path === "/" ? FALLBACK : path}`;
}

/** The callback in this page's own address, or the dashboard. Reads the URL only when called, in the browser. */
export function callbackFromLocation(): string {
  if (typeof window === "undefined") return FALLBACK;
  const value = new URLSearchParams(window.location.search).get("callbackUrl");
  return toSafePath(value, window.location.origin) ?? FALLBACK;
}
