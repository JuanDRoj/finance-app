import { NextResponse, type NextRequest } from "next/server";
import { pickCookie } from "@/lib/api/cookie-header";
import { serverEnv } from "@/lib/env/server";

/**
 * Routes that need no session. Everything else the matcher catches does: a new route is private
 * until it is listed here.
 *
 * - `/login`: it must NOT bounce to `/` when a cookie exists. The cookie only says that something
 *   is there, not that it is valid, so an expired or revoked one would loop (`/` -> 401 ->
 *   `/login` -> `/`). A Server Component cannot clear it.
 * - `/catalog`: the component catalog, a route only in `next dev`. In production it does not
 *   exist, so it answers 404 instead of redirecting.
 */
const PUBLIC_PATHS = ["/login", "/catalog"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * Private routes without a session cookie go to `/login`. It only checks that the cookie exists
 * (and is not empty): whether it is valid is for the backend to say, and a Server Component
 * redirects to `/login` on its 401. Same rule as `getServerApi()` (`pickCookie`), so "there is a
 * session cookie" means the same here and in what is forwarded to the backend.
 */
export function proxy(request: NextRequest) {
  if (isPublicPath(request.nextUrl.pathname)) return NextResponse.next();

  if (pickCookie(request.headers.get("cookie"), serverEnv.SESSION_COOKIE_NAME)) {
    return NextResponse.next();
  }

  const login = request.nextUrl.clone();
  login.pathname = "/login";
  // Not the query of the page they wanted (nor the `_rsc` of a client navigation).
  login.search = "";
  const response = NextResponse.redirect(login);
  // Whether it redirects depends on the cookie: no cache may keep this answer.
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = {
  matcher: [
    // Everything except:
    // - `/api/*`: the rewrite to the backend. Login (`POST /api/auth/session`) and logout go
    //   through it, and a 401 from the backend must reach the client as a 401.
    // - `/_next/static` and `/_next/image`: build assets and the image optimizer.
    // - The static files of `public/` (brand kit, favicon, manifest), by extension: `/login` shows
    //   them without a session. A test lists `public/` and fails if a file is not covered here.
    "/((?!api(?:/|$)|_next/static/|_next/image|.*\\.(?:png|svg|ico|webmanifest)$).*)",
  ],
};
