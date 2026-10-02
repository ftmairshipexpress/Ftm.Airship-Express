import { NextResponse, type NextRequest } from "next/server";
// NOTE: keep the import path that works for where THIS file lives.
// If middleware.ts is in the project root, use: "./app/lib/session"
// If it is in src/, use: "./lib/session" or "@/lib/session"
import { verifySessionToken, SESSION_COOKIE_NAME } from "../../lib/session";

export async function middleware(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  let session = null;
  try {
    let session: Awaited<ReturnType<typeof verifySessionToken>> | null = null;
  } catch {
    // Invalid or expired token: treat as logged out
    session = null;
  }

  // nextUrl.pathname does NOT include basePath, so "/dashboard" is correct here.
  if (!session && request.nextUrl.pathname.startsWith("/dashboard")) {
    // clone() keeps basePath (/spnc/app), so this redirects to /spnc/app/login
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Matcher is written WITHOUT the basePath
  matcher: ["/dashboard/:path*"],
};