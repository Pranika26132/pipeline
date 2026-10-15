import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  // Don't put this client in a global variable. Create a new one on each request.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
          // Cache headers stop a CDN from caching a response that carries a session.
          Object.entries(headers).forEach(([key, value]) =>
            supabaseResponse.headers.set(key, value),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and supabase.auth.getClaims().
  // Removing getClaims() can cause users to be randomly logged out.
  const { data } = await supabase.auth.getClaims();

  const user = data?.claims;

  if (
    !user &&
    request.nextUrl.pathname !== "/login" &&
    !request.nextUrl.pathname.startsWith("/auth/")
  ) {
    // API callers get a JSON error they can show, not a redirect to a page.
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ ok: false, error: "You're signed out. Sign in again." }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Return supabaseResponse as is. A new response object would drop the
  // refreshed cookies and sign the user out early.
  return supabaseResponse;
}
