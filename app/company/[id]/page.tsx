import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { redactSecrets } from "@/lib/redact";
import type { Reason } from "@/lib/scoring";
import { createClient } from "@/lib/supabase/server";

import { LocalDate } from "../../local-date";
import { AddPersonForm } from "./add-person";
import { EnrichButton, ResearchButton } from "./enrich-button";

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
      .select("id, name, url, domain, summary, stage, size, source, needs_manual_info, created_at, field_sources, open_roles, enriched_at, enrich_error, score, score_reasons, connection, connection_source_url")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("contacts")
      .select(
        "id, name, title, school, hometown, source_url, source_quote, email, school_source_url, school_quote, hometown_source_url, hometown_quote, added_by_user, school_status, hometown_status, school_evidence, hometown_evidence",
      )
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
  const sources = (company.field_sources ?? {}) as Record<string, string | undefined>;
  const roles = (Array.isArray(company.open_roles) ? company.open_roles : []) as {
    title: string;
    location: string | null;
    source_url: string;
  }[];

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
          The company’s pages didn’t name anyone on the team. Add details by hand.
        </p>
      )}

      <section aria-label="Look up" className="mt-6 flex flex-col gap-3">
        <EnrichButton companyId={company.id} domain={company.domain} looked={!!company.enriched_at} />
        {company.enriched_at && (
          <p className="text-base text-muted">
            Last looked up <LocalDate iso={company.enriched_at} withTime />.
          </p>
        )}
        {company.enrich_error && (
          <div className="rounded-md bg-danger-surface px-4 py-3 text-base text-danger">
            <p className="font-semibold">From the last lookup:</p>
            <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
              {/* Redacted again here so a row saved before the fix can't show a key. */}
              {redactSecrets(company.enrich_error, [process.env.ANTHROPIC_API_KEY]).split("\n").map((line: string, i: number) => (
                <li key={i} className="wrap-anywhere">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <ScoreSection
        score={company.score}
        reasons={(Array.isArray(company.score_reasons) ? company.score_reasons : []) as Reason[]}
        lookedUp={!!company.enriched_at}
        domain={company.domain}
      />

      <section aria-labelledby="about" className="mt-10 border-t-2 border-foreground pt-6">
        <h2 id="about" className="text-xl font-semibold">
          About
        </h2>
        {company.summary ? (
          <p className="mt-3 max-w-[65ch] text-lg">
            {company.summary} <SourceLink url={sources.summary} />
          </p>
        ) : (
          <p className="mt-3 text-lg text-muted">
            {company.enriched_at ? "The pages didn’t say what the company does." : "Not looked up yet."}
          </p>
        )}
        <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-base">
          <Fact term="Stage">
            {company.stage && (
              <>
                {company.stage} <SourceLink url={sources.stage} />
              </>
            )}
          </Fact>
          <Fact term="Size">
            {company.size && (
              <>
                {company.size} <SourceLink url={sources.size} />
              </>
            )}
          </Fact>
          <Fact term="Added from">{describeSource(company.source)}</Fact>
          {company.connection && (
            <Fact term="Tagged">
              {company.connection} <span className="text-muted">(from your list)</span>{" "}
              <SourceLink url={company.connection_source_url} />
            </Fact>
          )}
          <Fact term="Added on">
            <LocalDate iso={company.created_at} />
          </Fact>
        </dl>
      </section>

      <section aria-labelledby="roles" className="mt-10 border-t-2 border-foreground pt-6">
        <h2 id="roles" className="text-xl font-semibold">
          Open roles
        </h2>
        {roles.length === 0 ? (
          <p className="mt-3 text-lg text-muted">
            {company.enriched_at ? "None listed on the pages that were read." : "Not looked up yet."}
          </p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-rule border-y border-rule">
            {roles.map((r, i) => (
              <li key={i} className="flex flex-col gap-1 py-3">
                <p className="text-lg font-semibold wrap-anywhere">{r.title}</p>
                <p className="text-base text-muted">
                  {r.location && `${r.location}. `}
                  <SourceLink url={r.source_url} />
                </p>
              </li>
            ))}
          </ul>
        )}
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
                <li key={p.id} className="flex flex-col gap-2 py-4">
                  <div>
                    <p className="text-lg font-semibold wrap-anywhere">{p.name}</p>
                    {p.title && <p className="text-base">{p.title}</p>}
                  </div>
                  {p.source_quote && (
                    <div className="flex flex-col gap-1">
                      <p className="text-sm text-muted">
                        Named as {p.title?.toLowerCase() ?? "a leader"} <FoundOn url={p.source_url} domain={company.domain} />
                      </p>
                      <blockquote className="border-l-2 border-rule pl-3 text-sm leading-relaxed text-muted wrap-anywhere">
                        “{p.source_quote.trim()}”
                      </blockquote>
                    </div>
                  )}
                  <PersonFact label="School" value={p.school} url={p.school_source_url ?? p.source_url} quote={p.school_quote} byUser={p.added_by_user} domain={company.domain} status={p.school_status} evidence={p.school_evidence} />
                  <PersonFact label="From" value={p.hometown} url={p.hometown_source_url ?? p.source_url} quote={p.hometown_quote} byUser={p.added_by_user} domain={company.domain} status={p.hometown_status} evidence={p.hometown_evidence} />
                  {p.email && <p className="text-base wrap-anywhere">{p.email}</p>}
                  {p.added_by_user ? (
                    <p className="text-sm text-muted">Added by you{source ? "" : ", without a link"}.</p>
                  ) : null}
                  {source && (
                    <a
                      href={source}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-h-12 w-fit items-center text-base underline underline-offset-4"
                    >
                      {p.added_by_user ? "Your link" : "Where this person was found"}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-6 flex flex-col gap-6">
          <ResearchButton companyId={company.id} />
          <AddPersonForm companyId={company.id} />
        </div>
      </section>
    </article>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{term}</dt>
      <dd className="wrap-anywhere">{children || <span className="text-muted">Unknown</span>}</dd>
    </>
  );
}

// Links a fact to the page it came from, labelled with that page's path.
function SourceLink({ url }: { url?: string | null }) {
  const href = safeHref(url ?? null);
  if (!href) return null;
  const { pathname } = new URL(href);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-base whitespace-nowrap text-muted underline underline-offset-4"
    >
      (source: {pathname === "/" ? "home page" : pathname})
    </a>
  );
}

// A school or hometown with the page that states it and, when founder
// research found it, the sentence quoted from that page.
function PersonFact({
  label,
  value,
  url,
  quote,
  byUser,
  domain,
  status,
  evidence,
}: {
  label: string;
  value: string | null;
  url: string | null;
  quote: string | null;
  byUser: boolean;
  domain: string;
  status: string | null;
  evidence: unknown;
}) {
  if (!value) return null;
  const sources = (Array.isArray(evidence) ? evidence : []) as { value: string; quote: string; url: string; single: boolean }[];

  // Sources disagree: show every value with where it came from; not scored.
  if (status === "conflicting") {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-danger px-3 py-2">
        <p className="text-base">
          <span className="text-muted">{label}:</span> <span className="font-semibold text-danger">Sources disagree</span>
          <span className="block text-sm text-muted">Not counted toward the score.</span>
        </p>
        <ul className="flex flex-col gap-2">
          {sources.map((e, i) => (
            <li key={i} className="flex flex-col gap-1">
              <p className="text-base">
                <span className="font-medium">{e.value}</span> <FoundOn url={e.url} domain={domain} />
              </p>
              <Quote text={e.quote} />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="text-base">
        <span className="text-muted">{label}:</span> <span className="font-medium">{value}</span>{" "}
        {byUser && !safeHref(url) ? null : <FoundOn url={url} domain={domain} />}
      </p>
      {status === "shared" && (
        <p className="text-sm text-muted">Not counted: only a sentence about several people says this.</p>
      )}
      {quote && <Quote text={quote} />}
    </div>
  );
}

function Quote({ text }: { text: string }) {
  return (
    <blockquote className="border-l-2 border-rule pl-3 text-sm leading-relaxed text-muted wrap-anywhere">
      “{text.trim()}”
    </blockquote>
  );
}

// Every reason, with its points and the page it came from.
function ScoreSection({
  score,
  reasons,
  lookedUp,
  domain,
}: {
  score: number | null;
  reasons: Reason[];
  lookedUp: boolean;
  domain: string;
}) {
  return (
    <section aria-labelledby="score" className="mt-8 border-t-2 border-foreground pt-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="score" className="text-2xl font-semibold tracking-[-0.02em]">
          Why it ranks here
        </h2>
        {score !== null && (
          <p className="shrink-0 text-right">
            <span className="text-4xl font-bold tabular-nums tracking-[-0.03em]">{score}</span>{" "}
            <span className="text-base text-muted">{score === 1 ? "point" : "points"}</span>
          </p>
        )}
      </div>
      {!lookedUp ? (
        <p className="mt-3 text-lg text-muted">Look up the company to score it.</p>
      ) : score === null ? (
        <p className="mt-3 text-lg text-muted">
          Not scored yet. <Link href="/profile" className="underline underline-offset-4">Save your profile</Link> to score
          your list.
        </p>
      ) : reasons.length === 0 ? (
        <p className="mt-3 text-lg text-muted">
          Nothing on its pages matched <Link href="/profile" className="underline underline-offset-4">your profile</Link>.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col divide-y divide-rule border-y border-rule">
          {reasons.map((r, i) => (
            <li key={i} className="grid grid-cols-[3rem_1fr] gap-x-3 py-3">
              <span className="text-lg font-semibold tabular-nums text-accent">+{r.points}</span>
              <span className="text-lg">
                <span className="wrap-anywhere">{r.text}</span> <FoundOn url={r.source_url} domain={domain} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// "found on /team" for the company's own site, "found on fortune.com" for
// another; "from what you added" when the user typed or imported it.
function FoundOn({ url, domain }: { url: string | null; domain: string }) {
  const href = safeHref(url);
  if (!href) return <span className="text-base text-muted">— from what you added</span>;
  const { pathname, hostname } = new URL(href);
  const host = hostname.replace(/^www\./, "");
  const own = host === domain || host.endsWith(`.${domain}`);
  return (
    <span className="text-base text-muted">
      — found on{" "}
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center underline underline-offset-4 wrap-anywhere"
      >
        {own ? (pathname === "/" ? "the home page" : pathname) : host}
      </a>
    </span>
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
