import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

// The sign-up confirmation email links here. Supports both the token_hash
// template from the Supabase SSR guide and the default ?code= PKCE link.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  // Build the redirect without the secret token.
  const redirectTo = request.nextUrl.clone();
  redirectTo.search = "";

  let message: string;
  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      redirectTo.pathname = "/";
      return NextResponse.redirect(redirectTo);
    }
    message = `That confirmation link didn't work (${error.message}). Sign in, or create your account again to get a new link.`;
  } else if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      redirectTo.pathname = "/";
      return NextResponse.redirect(redirectTo);
    }
    message = `That confirmation link didn't work (${error.message}). Open it in the browser you signed up in, or sign in.`;
  } else {
    message =
      searchParams.get("error_description") ??
      "That confirmation link is missing its token. Open the link from the email again.";
  }

  redirectTo.pathname = "/login";
  redirectTo.searchParams.set("error", message);
  return NextResponse.redirect(redirectTo);
}
