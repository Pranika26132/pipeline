"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { FIND_COST_NOTE, FIND_MAX_SEARCHES, FIND_REQUEST_MAX, type FoundCompany } from "@/lib/find-limits";

import { addFromFind, type AddState } from "./add/actions";
import type { FindResponse } from "./api/find/route";
import { queueLookup } from "./look-up-all";

const field =
  "min-h-12 w-full rounded-md border border-rule bg-field px-4 py-3 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";
const primary =
  "min-h-14 rounded-lg bg-accent px-6 text-lg font-semibold text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60";

type Results = { request: string; companies: FoundCompany[]; searches: number; leftOut: string[]; notes: string[] };

// "Find companies": Claude searches the web for companies matching a request.
// Results are a checklist; nothing is added until the user taps Add.
// `onBusy` reports a running search or add; `onDone` fires when one finishes,
// so a closed box can reopen to show the results or the error.
export function FindCompanies({
  inputRef,
  onBusy,
  onDone,
}: {
  inputRef?: React.Ref<HTMLTextAreaElement>;
  onBusy?: (busy: "searching" | "adding" | null) => void;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const [request, setRequest] = useState("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<AddState | null>(null);

  async function find(e: React.FormEvent) {
    e.preventDefault();
    if (searching) return;
    setSearching(true);
    onBusy?.("searching");
    setError(null);
    setAdded(null);
    let body: FindResponse | null = null;
    try {
      const res = await fetch("/api/find", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request }),
      });
      body =
        ((await res.json().catch(() => null)) as FindResponse | null) ??
        { ok: false, error: `The server answered ${res.status} without a readable result. Try again.` };
    } catch (err) {
      body = { ok: false, error: `Couldn't reach the server (${(err as Error).message}). Check your connection.` };
    }
    setSearching(false);
    onBusy?.(null);
    onDone?.();
    if (!body.ok) {
      setError(body.error);
      return;
    }
    setResults({ request: request.trim(), companies: body.companies, searches: body.searches, leftOut: body.leftOut, notes: body.notes });
    setTicked(new Set(body.companies.map((c) => c.domain)));
  }

  async function add() {
    if (!results || adding) return;
    const picked = results.companies.filter((c) => ticked.has(c.domain));
    if (picked.length === 0) return;
    setAdding(true);
    onBusy?.("adding");
    let state: AddState;
    try {
      state = await addFromFind(picked.map((c) => ({ name: c.name, url: c.url })), results.request);
    } catch {
      state = { error: "Couldn't reach the server, so nothing was added. Try again." };
    }
    setAdding(false);
    onBusy?.(null);
    onDone?.();
    setAdded(state);
    if (state.added?.length) {
      // Added companies go straight into Look up all and get scored.
      queueLookup(state.added);
      setResults(null);
      startRefresh(() => router.refresh());
    }
  }

  const pickedCount = results ? results.companies.filter((c) => ticked.has(c.domain)).length : 0;
  const allTicked = !!results && pickedCount === results.companies.length;

  return (
    <section aria-labelledby="find" className="flex flex-col gap-4 rounded-lg border-2 border-foreground p-4">
      {/* The "Find companies" button above the box already names it. */}
      <h2 id="find" className="sr-only">
        Find companies
      </h2>
      <form onSubmit={find} className="flex flex-col gap-3">
        <label className="flex flex-col gap-2">
          <span className="text-base text-muted">Say what you’re looking for. Your profile is used too.</span>
          <textarea
            ref={inputRef}
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            rows={2}
            maxLength={FIND_REQUEST_MAX}
            placeholder="Early-stage quant firms in NYC hiring interns"
            className={`${field} leading-relaxed`}
          />
        </label>
        <button type="submit" disabled={searching || request.trim().length < 3} aria-busy={searching} className={primary}>
          {searching ? "Searching…" : "Search"}
        </button>
        <p className="text-sm text-muted">
          {searching
            ? "Searching the web and checking each company’s own website. This can take up to 2 minutes."
            : `Up to ${FIND_MAX_SEARCHES} web searches, ${FIND_COST_NOTE} of your API credit. Nothing is added until you choose.`}
        </p>
      </form>

      <div aria-live="polite" className="flex flex-col gap-3 empty:hidden">
        {error && (
          <p role="alert" className="rounded-md bg-danger-surface px-4 py-3 text-base text-danger">
            {error}
          </p>
        )}
        {added?.error && (
          <p role="alert" className="rounded-md bg-danger-surface px-4 py-3 text-base text-danger">
            {added.error}
          </p>
        )}
        {added && !added.error && (
          <p className="rounded-md border border-accent px-4 py-3 text-base">
            {added.added?.length
              ? `Added ${added.added.length}. ${added.added.length === 1 ? "It’s" : "They’re"} being looked up below.`
              : "Nothing new was added."}
            {added.rows?.filter((r) => r.status !== "added").map((r) => ` ${r.label}: ${r.message}`).join("")}
          </p>
        )}
      </div>

      {results && (
        <div className="flex flex-col gap-3">
          <p className="text-base text-muted">
            {results.companies.length === 0
              ? `No companies passed the checks (${results.searches} ${results.searches === 1 ? "search" : "searches"}). Try a broader request.`
              : `${results.companies.length} found with ${results.searches} ${results.searches === 1 ? "search" : "searches"}. Each one’s website was read to confirm it.`}
          </p>
          {results.notes.map((n, i) => (
            <p key={i} className="text-base text-danger">
              {n}
            </p>
          ))}
          {results.companies.length > 0 && (
            <>
              <ul className="flex flex-col divide-y divide-rule border-y border-rule">
                {results.companies.map((c) => (
                  <li key={c.domain}>
                    <label className="flex cursor-pointer gap-3 py-3">
                      <input
                        type="checkbox"
                        checked={ticked.has(c.domain)}
                        onChange={(e) => {
                          const next = new Set(ticked);
                          if (e.target.checked) next.add(c.domain);
                          else next.delete(c.domain);
                          setTicked(next);
                        }}
                        className="mt-1 size-6 shrink-0 accent-[var(--accent)]"
                      />
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="text-lg font-semibold wrap-anywhere">{c.name}</span>
                        <span className="text-base wrap-anywhere">{c.description}</span>
                        <span className="text-base text-muted wrap-anywhere">{c.why}</span>
                      </span>
                    </label>
                    {/* Links sit outside the label so tapping them doesn't untick the row. */}
                    <p className="flex flex-wrap gap-x-4 pb-3 pl-9 text-base">
                      <a href={c.url} target="_blank" rel="noopener noreferrer" className="flex min-h-12 items-center underline underline-offset-4 wrap-anywhere">
                        {c.domain}
                      </a>
                      <a href={c.source_url} target="_blank" rel="noopener noreferrer" className="flex min-h-12 items-center text-muted underline underline-offset-4">
                        Found on {hostOf(c.source_url)}
                      </a>
                    </p>
                  </li>
                ))}
              </ul>
              <button type="button" onClick={add} disabled={adding || pickedCount === 0} aria-busy={adding} className={primary}>
                {adding ? "Adding…" : allTicked ? `Add all ${pickedCount}` : `Add ${pickedCount} selected`}
              </button>
              <p className="text-sm text-muted">
                Adding also looks each one up and scores it: roughly 2 to 5 cents a company. Keep this page open while it runs.
              </p>
            </>
          )}
          {results.leftOut.length > 0 && (
            <details>
              <summary className="flex min-h-12 cursor-pointer items-center text-base font-medium underline underline-offset-4">
                {results.leftOut.length} left out
              </summary>
              <ul className="flex flex-col gap-1 pb-2 text-base text-muted">
                {results.leftOut.map((t, i) => (
                  <li key={i} className="wrap-anywhere">
                    {t}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "a web page";
  }
}
