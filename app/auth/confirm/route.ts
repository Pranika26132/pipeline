import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import { type LinkErrorCode } from "@/lib/auth-link-errors";
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

  let errorCode: LinkErrorCode;
  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      redirectTo.pathname = "/";
      return NextResponse.redirect(redirectTo);
    }
    errorCode = error.code === "otp_expired" ? "link_expired" : "link_invalid";
  } else if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      redirectTo.pathname = "/";
      return NextResponse.redirect(redirectTo);
    }
    errorCode = error.code === "otp_expired" ? "link_expired" : "link_other_browser";
  } else if (searchParams.has("error_code") || searchParams.has("error")) {
    // Supabase's own verify endpoint redirects here with ?error_code= when the link fails.
    errorCode = searchParams.get("error_code") === "otp_expired" ? "link_expired" : "link_invalid";
  } else {
    errorCode = "link_missing";
  }

  redirectTo.pathname = "/login";
  redirectTo.searchParams.set("error", errorCode);
  return NextResponse.redirect(redirectTo);
}
