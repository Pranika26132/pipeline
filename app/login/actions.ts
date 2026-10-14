"use server";

import { isAuthError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type AuthMode = "signin" | "signup";

export type AuthFormState = {
  mode?: AuthMode;
  error?: string;
  notice?: string;
  email?: string;
};

const ALREADY_REGISTERED = "An account with this email already exists. Sign in instead.";

function describeAuthError(error: unknown): string {
  if (!isAuthError(error)) {
    return error instanceof Error ? error.message : "Something went wrong. Try again.";
  }
  switch (error.code) {
    case "invalid_credentials":
      return "That email and password don't match. Check both and try again.";
    case "email_not_confirmed":
      return "Confirm your email first. Open the link we sent you, then sign in.";
    case "user_already_exists":
    case "email_exists":
      return ALREADY_REGISTERED;
    case "weak_password":
      return `Choose a stronger password. ${error.message}`;
    case "email_address_invalid":
      return "That email address isn't valid. Check it and try again.";
    case "signup_disabled":
      return "New sign-ups are turned off for this app.";
    case "over_email_send_rate_limit":
      return "Too many emails sent to this address. Wait a few minutes and try again.";
    case "over_request_rate_limit":
      return "Too many attempts. Wait a minute and try again.";
  }
  if (error.name === "AuthRetryableFetchError") {
    return "Couldn't reach the sign-in server. Check your connection and try again.";
  }
  return error.message;
}

export async function authenticate(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const mode: AuthMode = formData.get("mode") === "signup" ? "signup" : "signin";
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { mode, email, error: "Enter your email and password." };
  }

  const supabase = await createClient();

  if (mode === "signin") {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      return { mode, email, error: describeAuthError(error) };
    }
    revalidatePath("/", "layout");
    redirect("/");
  }

  const origin = (await headers()).get("origin");
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: origin ? { emailRedirectTo: `${origin}/auth/confirm` } : undefined,
  });
  if (error) {
    return { mode, email, error: describeAuthError(error) };
  }
  // Supabase returns a user with no identities when the email is already
  // registered, instead of an error.
  if (data.user && data.user.identities?.length === 0) {
    return { mode, email, error: ALREADY_REGISTERED };
  }
  if (!data.session) {
    return {
      mode,
      email,
      notice: `Check ${email} for a confirmation link. Open it on this device to finish signing up.`,
    };
  }
  revalidatePath("/", "layout");
  redirect("/");
}
