import Link from "next/link";
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
        Signed in as <Email address={data.claims.email ?? ""} />
      </p>
      <Link
        href="/add"
        className="flex min-h-14 items-center justify-center rounded-lg bg-accent px-6 text-lg font-semibold text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Add companies
      </Link>
      <SignOutButton />
    </div>
  );
}

// Keeps the address in one piece and moves it to its own line when it fits.
// If it is wider than the screen it breaks before the "@", and only breaks
// inside a part when that part alone is wider than the screen.
function Email({ address }: { address: string }) {
  const at = address.lastIndexOf("@");
  const part = "inline-block max-w-full wrap-anywhere";
  if (at <= 0) {
    return <span className={`font-semibold ${part}`}>{address}</span>;
  }
  return (
    <span className={`font-semibold ${part}`}>
      <span className={part}>{address.slice(0, at)}</span>
      <wbr />
      <span className={part}>{address.slice(at)}</span>
    </span>
  );
}
