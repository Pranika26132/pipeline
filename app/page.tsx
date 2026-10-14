import { redirect } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";

import { SignOutButton } from "./sign-out-button";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col px-4 pt-14 pb-10 sm:pt-24">
      <h1 className="text-6xl font-bold tracking-[-0.05em]">Pipeline</h1>
      <Suspense fallback={<p className="mt-6 text-lg text-muted">Checking your session…</p>}>
        <Account />
      </Suspense>
    </main>
  );
}

// Reads the session at request time, so it streams in behind the boundary.
async function Account() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error) {
    return (
      <div className="mt-6 flex flex-col gap-6">
        <p role="alert" className="rounded-md bg-danger-surface px-4 py-3 text-base text-danger">
          Your session couldn’t be checked ({error.message}). Sign in again.
        </p>
        <a
          href="/login"
          className="flex min-h-14 items-center justify-center rounded-lg bg-accent px-6 text-lg font-semibold text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Go to sign in
        </a>
      </div>
    );
  }
  if (!data?.claims) {
    redirect("/login");
  }

  return (
    <div className="mt-6 flex flex-col gap-10">
      <p className="text-lg">
        Signed in as <span className="font-semibold break-all">{data.claims.email}</span>
      </p>
      <SignOutButton />
    </div>
  );
}
