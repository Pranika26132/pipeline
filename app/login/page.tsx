import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { linkErrorMessage } from "@/lib/auth-link-errors";
import { createClient } from "@/lib/supabase/server";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in · Pipeline",
};

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col px-4 pt-14 pb-10 sm:pt-24">
      <h1 className="text-6xl font-bold tracking-[-0.05em]">Pipeline</h1>
      <p className="mt-3 mb-10 max-w-[30ch] text-lg text-muted">
        Find small firms to email for tech and quant internships.
      </p>
      <Suspense fallback={<p className="text-base text-muted">Checking your session…</p>}>
        <SignedOutGate searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

// Reads the session at request time, so it streams in behind the boundary.
async function SignedOutGate({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (data?.claims) {
    redirect("/");
  }

  // Errors from the email confirmation link arrive as ?error=<code>.
  const linkError = linkErrorMessage((await searchParams).error);
  const initialError =
    linkError ??
    (error
      ? `Your saved session couldn't be checked (${error.message}). Sign in again.`
      : undefined);

  return <LoginForm initialError={initialError} />;
}
