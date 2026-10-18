import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { displayName } from "@/lib/domain";
import { availableHooks, draftFacts, MAX_WORDS } from "@/lib/drafts";
import { canCheckFit, currentFits, fitFor, fitKey, VERDICT_LABELS, type FitVerdict } from "@/lib/fit";
import { roleTiming } from "@/lib/roles";
import { readLocations } from "@/lib/locations";
import { redactSecrets } from "@/lib/redact";
import type { Reason } from "@/lib/scoring";
import { createClient } from "@/lib/supabase/server";

import { LocalDate } from "../../local-date";
import { TopBar } from "../../top-bar";
import { AddPersonForm } from "./add-person";
import { CheckFitButton } from "./check-fit-button";
import { RenameForm } from "./rename-form";
import { StatusPanel } from "./status-panel";
import { DraftPanel } from "./draft-panel";
import { EnrichButton, ResearchButton } from "./enrich-button";

export const metadata: Metadata = {
  title: "Company · Pipeline",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function CompanyPage({ params }: PageProps<"/company/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 pt-6 pb-16 sm:pt-12">
      <TopBar />
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
  const [companyResult, contactsResult, draftResult, profileResult] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name, url, domain, summary, stage, size, source, needs_manual_info, created_at, field_sources, open_roles, enriched_at, enrich_error, score, score_reasons, connection, connection_source_url, role_fit, locations")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("contacts")
      .select(
        "id, name, title, school, hometown, source_url, source_quote, email, school_source_url, school_quote, hometown_source_url, hometown_quote, added_by_user, school_status, hometown_status, school_evidence, hometown_evidence",
      )
      .eq("company_id", id)
      .order("name"),
    supabase
      .from("outreach")
      .select("subject, draft, contact_id, status, follow_up_on, sent_at, is_follow_up")
      .eq("company_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("profiles").select("school, hometown, interests, role_targets, grad_year, degree, major, resume").maybeSingle(),
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
    details?: string | null;
    source_url: string;
  }[];
  // Fit verdicts count only while they match the current profile.
  const profile = profileResult.data;
  const fits = profile ? currentFits(company.role_fit, fitKey(profile)) : null;
  const staleFit = !fits && !!company.role_fit;
  // Checked, but some roles have no verdict (none should after a lookup; kept as a guard).
  const unjudged = fits ? roles.filter((r) => !fitFor(fits, r)).length : 0;
  const today = new Date();

  return (
    <article className="mt-6 flex flex-col">
      <h1 className="text-4xl font-bold tracking-[-0.04em] wrap-anywhere">{displayName(company.name, company.domain)}</h1>
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
      <RenameForm companyId={company.id} current={displayName(company.name, company.domain)} />

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

      <section aria-labelledby="status" className="mt-8 border-t-2 border-foreground pt-6">
        <h2 id="status" className="sr-only">
          Status
        </h2>
        {draftResult.error ? (
          <Alert>Couldn’t load the status ({draftResult.error.message}). Reload to try again.</Alert>
        ) : (
          <StatusPanel
            // Remounts when the saved status changes (e.g. a draft made it
            // "drafted"), so the panel never saves a stale choice back.
            key={`${draftResult.data?.status}|${draftResult.data?.follow_up_on}|${draftResult.data?.sent_at}|${draftResult.data?.is_follow_up}`}
            companyId={company.id}
            status={draftResult.data?.status ?? "to_contact"}
            followUpOn={draftResult.data?.follow_up_on ?? null}
            sentAt={draftResult.data?.sent_at ?? null}
            isFollowUp={!!draftResult.data?.is_follow_up}
          />
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
          {readLocations(company.locations).length > 0 && (
            <Fact term="Locations">
              <ul className="flex flex-col gap-2">
                {readLocations(company.locations).map((l, i) => (
                  <li key={i} className="flex flex-col">
                    <span>
                      {l.kind === "office" ? "Office" : "Role"} in {l.value} <SourceLink url={l.source_url} />
                    </span>
                    {l.quote && <q className="text-base text-muted">{l.quote}</q>}
                  </li>
                ))}
              </ul>
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
          <>
            <p className="mt-2 text-base text-muted">
              {!canCheckFit(profile)
                ? "Add the internship roles you want on your profile to check which of these fit you."
                : fits && unjudged > 0
                  ? `Checked against your profile, but ${unjudged} ${unjudged === 1 ? "role wasn’t" : "roles weren’t"}; until you check again, those count when the title matches.`
                  : fits
                  ? "Checked against your profile. Only roles that fit count toward the score."
                  : staleFit
                    ? "Your profile changed since fit was checked, so the score matches role titles for now."
                    : "Fit isn’t checked yet, so the score matches role titles for now."}
            </p>
            <ul className="mt-3 flex flex-col divide-y divide-rule border-y border-rule">
              {roles.map((r, i) => {
                const fit = fitFor(fits, r);
                // Past dates are flagged even before fit is checked.
                const verdict: FitVerdict | null = fit?.verdict ?? (roleTiming(r.title, today) === "past" ? "past" : null);
                return (
                  <li key={i} className="flex flex-col gap-1 py-3">
                    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="text-lg font-semibold wrap-anywhere">{r.title}</span>
                      {verdict && <VerdictBadge verdict={verdict} />}
                    </p>
                    {fit && <p className="text-base">{fit.reason}</p>}
                    {!fit && verdict === "past" && <p className="text-base">The dates in the title have passed, so it isn’t open now.</p>}
                    <p className="text-base text-muted">
                      {r.location && `${r.location}. `}
                      <SourceLink url={r.source_url} />
                    </p>
                  </li>
                );
              })}
            </ul>
            {canCheckFit(profile) && (
              <div className="mt-4">
                <CheckFitButton companyId={company.id} label={fits ? "Check fit again" : "Check fit"} />
              </div>
            )}
          </>
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

      <section aria-labelledby="draft" className="mt-10 border-t-2 border-foreground pt-6">
        <h2 id="draft" className="text-xl font-semibold">
          Draft an email
        </h2>
        <p className="mt-2 text-base text-muted">
          Under {MAX_WORDS} words, built from one fact about {company.name} and your profile, in the tone of your writing
          samples.
        </p>
        <div className="mt-4">
          {draftResult.error || profileResult.error ? (
            <Alert>Couldn’t load the draft ({(draftResult.error ?? profileResult.error)!.message}). Reload to try again.</Alert>
          ) : (
            <DraftPanel
              companyId={company.id}
              people={(contactsResult.data ?? []).map((p) => ({ id: p.id, name: p.name, title: p.title, email: p.email }))}
              hooks={availableHooks(draftFacts({ company, contact: null, profile: profileResult.data, today: new Date() }))}
              saved={
                draftResult.data?.draft
                  ? { subject: draftResult.data.subject ?? "", body: draftResult.data.draft, contactId: draftResult.data.contact_id }
                  : null
              }
            />
          )}
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

// A role's fit. Only "Fits you" counts toward the score.
function VerdictBadge({ verdict }: { verdict: FitVerdict }) {
  const style =
    verdict === "fits"
      ? "border-accent bg-accent text-accent-foreground"
      : verdict === "unclear"
        ? "border-rule text-muted"
        : "border-danger text-danger";
  return <span className={`rounded-sm border px-2 py-0.5 text-sm font-medium whitespace-nowrap ${style}`}>{VERDICT_LABELS[verdict]}</span>;
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
