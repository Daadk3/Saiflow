import { NextResponse } from "next/server";
import type { NextRequest, NextFetchEvent } from "next/server";
import { withAuth, type NextRequestWithAuth } from "next-auth/middleware";

// Locale prefix for the English slice, plus the existing dashboard session
// guard. Arabic stays on the unprefixed URL. /en is rewritten onto the same
// pages with a request header that i18n.ts prefers over the cookie.
// The cookie name matches LOCALE_COOKIE in i18n.ts. It is inlined here so
// middleware does not import the next-intl request config.

const LOCALE_COOKIE = "NEXT_LOCALE";
const ONE_YEAR = 60 * 60 * 24 * 365;

const dashboardAuth = withAuth({
  pages: { signIn: "/login" },
});

function englishCookie(response: NextResponse) {
  response.cookies.set(LOCALE_COOKIE, "en", {
    path: "/",
    maxAge: ONE_YEAR,
    sameSite: "lax",
  });
  return response;
}

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl;

  // Dashboard auth stays on the unprefixed path. Sending /en/dashboard
  // through a redirect keeps the session guard on the route it already owns.
  if (pathname === "/en/dashboard" || pathname.startsWith("/en/dashboard/")) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.replace(/^\/en/, "") || "/dashboard";
    return englishCookie(NextResponse.redirect(url));
  }

  if (pathname === "/en" || pathname.startsWith("/en/")) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.replace(/^\/en(?=\/|$)/, "") || "/";
    const headers = new Headers(request.headers);
    headers.set("x-saiflow-locale", "en");
    return englishCookie(NextResponse.rewrite(url, { request: { headers } }));
  }

  if (pathname.startsWith("/dashboard")) {
    return dashboardAuth(request as NextRequestWithAuth, event);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/en", "/en/:path*"],
};
