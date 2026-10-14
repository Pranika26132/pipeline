import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { createClient } from "@/lib/supabase/server";

import { LocalDate } from "../../local-date";

export const metadata: Metadata = {
  title: "Company · Pipeline",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function CompanyPage({ params }: PageProps<"/company/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 pt-6 pb-16 sm:pt-12">
      <Link
        href="/"
        className="-ml-2 flex min-h-12 w-fit items-center px-2 text-base font-medium underline underline-offset-4"
      >
        Back to your list
      </Link>
      <Suspense fallback={<p className="mt-6 text-lg text-muted">Loading company…</p>}>
        {params.then(({ id }) => (
          <Company id={id} />
        ))}
      </Suspense>
    </main>
  );
}

async function Company({ id }: { id: string }) {
  // A malformed id would otherwise reach Postgres as a type error.
  if (!UUID.test(id)) {
    notFound();
  }

  const supabase = await createClient();
  // RLS returns nothing for another user's company, which reads as not found.
  const [companyResult, contactsResult] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name, url, domain, summary, stage, size, source, needs_manual_info, created_at")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("contacts")
      .select("id, name, title, school, hometown, source_url, email")
      .eq("company_id", id)
      .order("name"),
  ]);

  if (companyResult.error) {
    return <Alert>Couldn’t load this company ({companyResult.error.message}). Reload to try again.</Alert>;
  }
  const company = companyResult.data;
  if (!company) {
    notFound();
  }

  const href = safeHref(company.url);

  return (
    <article className="mt-6 flex flex-col">
      <h1 className="text-4xl font-bold tracking-[-0.04em] wrap-anywhere">{company.name}</h1>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 flex min-h-12 w-fit items-center text-lg font-medium text-accent underline underline-offset-4 wrap-anywhere"
        >
          {company.domain}
        </a>
      ) : (
        <p className="mt-2 text-lg text-muted">{company.domain}</p>
      )}

      {company.needs_manual_info && (
        <p className="mt-4 rounded-md border border-danger px-4 py-3 text-base">
          The company’s pages didn’t say enough to fill this in. Add details by hand.
        </p>
      )}

      <section aria-labelledby="about" className="mt-8 border-t-2 border-foreground pt-6">
        <h2 id="about" className="text-xl font-semibold">
          About
        </h2>
        {company.summary ? (
          <p className="mt-3 max-w-[65ch] text-lg">{company.summary}</p>
        ) : (
          <p className="mt-3 text-lg text-muted">Not looked up yet.</p>
        )}
        <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-base">
          <Fact term="Stage">{company.stage}</Fact>
          <Fact term="Size">{company.size}</Fact>
          <Fact term="Added from">{describeSource(company.source)}</Fact>
          <Fact term="Added on">
            <LocalDate iso={company.created_at} />
          </Fact>
        </dl>
      </section>

      <section aria-labelledby="people" className="mt-10 border-t-2 border-foreground pt-6">
        <h2 id="people" className="text-xl font-semibold">
          People
        </h2>
        {contactsResult.error ? (
          <Alert>Couldn’t load contacts ({contactsResult.error.message}). Reload to try again.</Alert>
        ) : contactsResult.data.length === 0 ? (
          <p className="mt-3 text-lg text-muted">No one saved for this company yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-rule border-y border-rule">
            {contactsResult.data.map((p) => {
              const source = safeHref(p.source_url);
              return (
                <li key={p.id} className="flex flex-col gap-1 py-4">
                  <p className="text-lg font-semibold wrap-anywhere">{p.name}</p>
                  {p.title && <p className="text-base">{p.title}</p>}
                  {(p.school || p.hometown) && (
                    <p className="text-base text-muted">
                      {[p.school, p.hometown].filter(Boolean).join(", ")}
                    </p>
                  )}
                  {p.email && <p className="text-base wrap-anywhere">{p.email}</p>}
                  {source && (
                    <a
                      href={source}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-h-12 w-fit items-center text-base underline underline-offset-4"
                    >
                      Where this came from
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </article>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{term}</dt>
      <dd className="wrap-anywhere">{children ?? <span className="text-muted">Unknown</span>}</dd>
    </>
  );
}

function Alert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mt-6 rounded-md bg-danger-surface px-4 py-3 text-base text-danger">
      {children}
    </p>
  );
}

// Only http(s) links are rendered, whatever ended up in the row.
function safeHref(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function describeSource(source: string | null): string | null {
  if (!source) return null;
  if (source === "link") return "A pasted link";
  if (source.startsWith("csv:")) return `Spreadsheet ${source.slice(4)}`;
  return source;
}
