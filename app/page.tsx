import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import {
  CONTACTED,
  FACTOR_CHIPS,
  filtersHref,
  isFiltered,
  matchesFilters,
  STATUSES,
  toggleFactor,
  parseFilters,
  type Filters,
  type Status,
} from "@/lib/list-filters";
import { displayName } from "@/lib/domain";
import { isProfileEmpty } from "@/lib/profile";
import type { Factor, Reason } from "@/lib/scoring";
import { createClient } from "@/lib/supabase/server";

import { FollowUpBadge } from "./follow-up-badge";
import { FindCompanies } from "./find-companies";
import { LookUpAll } from "./look-up-all";
import { TopBar } from "./top-bar";

const LIST_LIMIT = 500;

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 pt-6 pb-10 sm:pt-12">
      <TopBar back={false} />
      <h1 className="mt-2 text-6xl font-bold tracking-[-0.05em]">Pipeline</h1>
      <Suspense fallback={<p className="mt-6 text-lg text-muted">Loading your companies…</p>}>
        {searchParams.then((params) => (
          <TargetList filters={parseFilters(params)} />
        ))}
      </Suspense>
    </main>
  );
}

// Reads the session and the list at request time, behind the boundary.
async function TargetList({ filters }: { filters: Filters }) {
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

  // RLS limits both to the signed-in user's rows.
  const [{ data: companies, error, count }, profileResult, outreach, notLooked] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name, domain, needs_manual_info, score, score_reasons, enriched_at", { count: "exact" })
      // Highest score first; companies not looked up yet go last.
      .order("score", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      // A CSV import saves every row with the same timestamp; list those A to Z.
      .order("name")
      .order("id")
      .range(0, LIST_LIMIT - 1),
    supabase.from("profiles").select("school, hometown, interests, role_targets, writing_samples").maybeSingle(),
    // One row per company with outreach (its newest status); none means "to contact".
    readStatuses(supabase),
    // For "Look up all": oldest first, the order they were added.
    supabase
      .from("companies")
      .select("id, name")
      .is("enriched_at", null)
      .order("created_at")
      .order("name")
      .limit(LIST_LIMIT),
  ]);

  const statusOf = new Map<string, StatusRow>("rows" in outreach ? outreach.rows : []);
  const rows = (companies ?? []).map((c) => {
    const reasons = (Array.isArray(c.score_reasons) ? c.score_reasons : []) as Reason[];
    return {
      ...c,
      reasons,
      factors: reasons.map((r) => r.factor) as Factor[],
      status: statusOf.get(c.id)?.status ?? ("to_contact" as Status),
      followUpOn: statusOf.get(c.id)?.followUpOn ?? null,
    };
  });
  const shown = rows.filter((r) => matchesFilters(r, filters));
  // How many more the toggle would show with the current chips.
  const hiddenContacted =
    filters.showContacted || filters.status
      ? 0
      : rows.filter((r) => CONTACTED.has(r.status) && matchesFilters(r, { ...filters, showContacted: true })).length;

  return (
    <>
      {profileResult.error ? (
        <p role="alert" className="mt-6 rounded-md bg-danger-surface px-4 py-3 text-base text-danger">
          Couldn’t load your profile ({profileResult.error.message}). Reload the page to try again.
        </p>
      ) : (
        isProfileEmpty(profileResult.data) && (
          <section aria-labelledby="profile-prompt" className="mt-8 flex flex-col gap-4 rounded-lg border-2 border-accent p-5">
            <h2 id="profile-prompt" className="text-2xl font-semibold tracking-[-0.02em]">
              Your profile is empty
            </h2>
            <p className="text-lg text-muted">
              Add your school, hometown and target roles so Pipeline can rank companies for you, plus a few writing
              samples for drafts.
            </p>
            <Link
              href="/profile"
              className="flex min-h-14 items-center justify-center rounded-lg border-2 border-accent px-6 text-lg font-semibold text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Fill in your profile
            </Link>
          </section>
        )
      )}
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
              ? `Showing the top ${companies.length} of ${count} companies, highest score first. Filters apply to these.`
              : `${companies.length} ${companies.length === 1 ? "company" : "companies"}, highest score first.`}
          </p>
        )}
        <Link
          href="/add"
          className="flex min-h-14 items-center justify-center rounded-lg bg-accent px-6 text-lg font-semibold text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Add companies
        </Link>
        <FindCompanies />
        {/* Always rendered, so a refresh that fails mid-run doesn't end the run. */}
        <LookUpAll
          pending={notLooked.data ?? []}
          loadError={
            notLooked.error
              ? `Couldn’t check which companies still need a lookup (${notLooked.error.message}). Reload to try again.`
              : null
          }
        />
      </div>

      {"error" in outreach && (
        <p role="alert" className="mt-6 rounded-md bg-danger-surface px-4 py-3 text-base text-danger">
          Couldn’t load contact statuses ({outreach.error}), so contacted companies may show. Reload to try again.
        </p>
      )}

      {rows.length > 0 && (
        <>
          <FilterBar filters={filters} hiddenContacted={hiddenContacted} />
          {shown.length === 0 ? (
            <div className="mt-6 flex flex-col gap-3">
              <p className="text-lg">No companies match these filters.</p>
              <Link
                href={filtersHref({ ...filters, factors: [], status: null })}
                className="-ml-2 flex min-h-12 w-fit items-center px-2 text-base font-medium underline underline-offset-4"
              >
                Clear filters
              </Link>
            </div>
          ) : (
            <ul className="mt-6 flex flex-col border-t-2 border-foreground">
              {shown.map((c) => (
                <li key={c.id} className="border-b border-rule">
                  <Link
                    href={`/company/${c.id}`}
                    className="-mx-2 grid min-h-16 grid-cols-[1fr_auto] items-center gap-x-4 rounded-md px-2 py-3 hover:bg-field focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-lg font-semibold wrap-anywhere">{displayName(c.name, c.domain)}</span>
                      {c.reasons[0] ? (
                        <span className="text-base text-muted wrap-anywhere">{c.reasons[0].text}</span>
                      ) : (
                        c.name !== c.domain && <span className="text-base text-muted wrap-anywhere">{c.domain}</span>
                      )}
                      {(c.needs_manual_info || c.status !== "to_contact" || c.followUpOn) && (
                        <span className="mt-1 flex flex-wrap gap-2">
                          {c.status !== "to_contact" && (
                            <span className="rounded-sm border border-foreground px-2 py-0.5 text-sm font-medium">
                              {STATUSES.find((s) => s.value === c.status)?.label}
                            </span>
                          )}
                          {c.followUpOn && <FollowUpBadge date={c.followUpOn} />}
                          {c.needs_manual_info && (
                            <span className="rounded-sm border border-danger px-2 py-0.5 text-sm font-medium text-danger">
                              Needs info
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                    <Score score={c.score} lookedUp={!!c.enriched_at} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

    </>
  );
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

// Reads the company_status view page by page: a single read stops at the
// API's row cap (1000) without an error.
type StatusRow = { status: Status; followUpOn: string | null };

async function readStatuses(supabase: Supabase): Promise<{ rows: [string, StatusRow][] } | { error: string }> {
  const rows: [string, StatusRow][] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("company_status")
      .select("company_id, status, follow_up_on")
      .order("company_id")
      .range(from, from + 999);
    if (error) return { error: error.message };
    for (const r of data) rows.push([r.company_id, { status: r.status as Status, followUpOn: r.follow_up_on }]);
    if (data.length < 1000) return { rows };
  }
}

// The number is the row's anchor: big, right-aligned, same width per digit.
function Score({ score, lookedUp }: { score: number | null; lookedUp: boolean }) {
  if (score === null) {
    // Looked up before scoring existed: saving the profile scores it.
    return (
      <span className="w-16 text-right text-sm leading-tight text-muted">{lookedUp ? "Not scored yet" : "Not looked up"}</span>
    );
  }
  return (
    <span className="flex w-16 flex-col items-end">
      <span className="text-3xl font-bold tabular-nums tracking-[-0.03em]">{score}</span>
      <span className="text-xs text-muted">{score === 1 ? "point" : "points"}</span>
    </span>
  );
}

const chip =
  "flex min-h-11 items-center rounded-full border px-4 text-base font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const chipOn = `${chip} border-accent bg-accent text-accent-foreground`;
const chipOff = `${chip} border-rule bg-field`;

function FilterBar({ filters, hiddenContacted }: { filters: Filters; hiddenContacted: number }) {
  return (
    <nav aria-label="Filter companies" className="mt-8 flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-muted">Show only</span>
        <div className="flex flex-wrap gap-2">
          {FACTOR_CHIPS.map((c) => {
            const on = filters.factors.includes(c.factor);
            return (
              <Link key={c.slug} href={filtersHref(toggleFactor(filters, c.factor))} aria-current={on ? "true" : undefined} className={on ? chipOn : chipOff}>
                {c.label}
              </Link>
            );
          })}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-muted">Status</span>
        <div className="flex flex-wrap gap-2">
          <Link href={filtersHref({ ...filters, status: null })} aria-current={filters.status === null ? "true" : undefined} className={filters.status === null ? chipOn : chipOff}>
            Any
          </Link>
          {STATUSES.map((s) => {
            const on = filters.status === s.value;
            return (
              <Link key={s.value} href={filtersHref({ ...filters, status: on ? null : s.value })} aria-current={on ? "true" : undefined} className={on ? chipOn : chipOff}>
                {s.label}
              </Link>
            );
          })}
        </div>
      </div>
      {!filters.status && (
        <Link
          href={filtersHref({ ...filters, showContacted: !filters.showContacted })}
          className="-ml-2 flex min-h-12 w-fit items-center px-2 text-base font-medium underline underline-offset-4"
        >
          {filters.showContacted
            ? "Hide companies you’ve contacted"
            : hiddenContacted > 0
              ? `Show ${hiddenContacted} ${hiddenContacted === 1 ? "company" : "companies"} you’ve contacted`
              : "Show companies you’ve contacted"}
        </Link>
      )}
      {isFiltered(filters) && (
        <Link
          href={filtersHref({ ...filters, factors: [], status: null })}
          className="-ml-2 flex min-h-12 w-fit items-center px-2 text-base font-medium underline underline-offset-4"
        >
          Clear filters
        </Link>
      )}
    </nav>
  );
}

// Keeps the address in one piece and moves it to its own line when it fits.
// If it is wider than the screen it breaks before the "@", and only breaks
// inside a part when that part alone is wider than the screen.
