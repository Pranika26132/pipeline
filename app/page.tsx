import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";

import { SignOutButton } from "./sign-out-button";

const LIST_LIMIT = 500;

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 pt-10 pb-10 sm:pt-16">
      <h1 className="text-6xl font-bold tracking-[-0.05em]">Pipeline</h1>
      <Suspense fallback={<p className="mt-6 text-lg text-muted">Loading your companies…</p>}>
        <TargetList />
      </Suspense>
    </main>
  );
}

// Reads the session and the list at request time, behind the boundary.
async function TargetList() {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError) {
    return (
      <div className="mt-6 flex flex-col gap-6">
        <p role="alert" className="rounded-md bg-danger-surface px-4 py-3 text-base text-danger">
          Your session couldn’t be checked ({authError.message}). Sign in again.
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
  if (!auth?.claims) {
    redirect("/login");
  }

  // RLS limits this to the signed-in user's rows.
  const { data: companies, error, count } = await supabase
    .from("companies")
    .select("id, name, domain, needs_manual_info", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id")
    .range(0, LIST_LIMIT - 1);

  return (
    <>
      <div className="mt-8 flex flex-col gap-5">
        {error ? (
          <p role="alert" className="rounded-md bg-danger-surface px-4 py-3 text-base text-danger">
            Couldn’t load your companies ({error.message}). Reload the page to try again.
          </p>
        ) : companies.length === 0 ? (
          <div className="flex flex-col gap-2">
            <h2 className="text-2xl font-semibold tracking-[-0.02em]">No companies yet</h2>
            <p className="text-lg text-muted">
              Paste a company’s website or import a spreadsheet to start your list.
            </p>
          </div>
        ) : (
          <p className="text-lg text-muted">
            {count && count > companies.length
              ? `Showing the newest ${companies.length} of ${count} companies.`
              : `${companies.length} ${companies.length === 1 ? "company" : "companies"}, newest first.`}
          </p>
        )}
        <Link
          href="/add"
          className="flex min-h-14 items-center justify-center rounded-lg bg-accent px-6 text-lg font-semibold text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Add companies
        </Link>
      </div>

      {companies && companies.length > 0 && (
        <ul className="mt-8 flex flex-col border-t-2 border-foreground">
          {companies.map((c) => (
            <li key={c.id} className="border-b border-rule">
              <Link
                href={`/company/${c.id}`}
                className="-mx-2 flex min-h-16 items-center justify-between gap-4 rounded-md px-2 py-3 hover:bg-field focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
              >
                <span className="min-w-0">
                  <span className="block text-lg font-semibold wrap-anywhere">{c.name}</span>
                  {c.name !== c.domain && (
                    <span className="block text-base text-muted wrap-anywhere">{c.domain}</span>
                  )}
                </span>
                {c.needs_manual_info && (
                  <span className="shrink-0 rounded-sm border border-danger px-2 py-0.5 text-sm font-medium text-danger">
                    Needs info
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* Pushes the account footer to the bottom on short lists. */}
      <div className="flex-1" />
      <footer className="mt-16 flex flex-col gap-4 border-t border-rule pt-6">
        <p className="text-base text-muted">
          Signed in as <Email address={auth.claims.email ?? ""} />
        </p>
        <SignOutButton />
      </footer>
    </>
  );
}

// Keeps the address in one piece and moves it to its own line when it fits.
// If it is wider than the screen it breaks before the "@", and only breaks
// inside a part when that part alone is wider than the screen.
function Email({ address }: { address: string }) {
  const at = address.lastIndexOf("@");
  const part = "inline-block max-w-full wrap-anywhere";
  if (at <= 0) {
    return <span className={`font-semibold text-foreground ${part}`}>{address}</span>;
  }
  return (
    <span className={`font-semibold text-foreground ${part}`}>
      <span className={part}>{address.slice(0, at)}</span>
      <wbr />
      <span className={part}>{address.slice(at)}</span>
    </span>
  );
}
