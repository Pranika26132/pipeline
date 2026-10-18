"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import type { EnrichResponse } from "./api/companies/[id]/enrich/route";
import type { ResearchResponse } from "./api/companies/[id]/research/route";
import { callCompanyApi } from "./company/[id]/enrich-button";

type Target = { id: string; name: string };
type Problem = { id: string; name: string; text: string };
type Run = {
  targets: Target[];
  done: number;
  current: string | null;
  failures: Problem[];
  // Looked up, but with notes (pages that couldn't be read, nobody named).
  warnings: Problem[];
  // Looked up meanwhile from somewhere else, so not looked up again.
  skipped: number;
  // Schools and hometowns founder research found, e.g. "Jane Doe: went to Duke".
  found: string[];
  stopped: string | null;
  finished: boolean;
};

// Looks up every company that hasn't been looked up, one at a time, through
// the same route as the button on a company page (so its checks and the
// one-minute wait apply). Runs while this page is open.
export function LookUpAll({ pending, loadError }: { pending: Target[]; loadError: string | null }) {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const stopRef = useRef(false);
  // Guards against a second tap starting a second run before the first renders.
  const runningRef = useRef(false);

  // Leaving the page stops the run after the current lookup.
  useEffect(() => () => void (stopRef.current = true), []);

  const running = run !== null && !run.finished;

  async function start() {
    if (runningRef.current) return;
    runningRef.current = true;
    setConfirming(false);
    stopRef.current = false;
    // A snapshot: the list refreshes during the run, but these are the targets.
    const targets = pending;
    let state: Run = { targets, done: 0, current: null, failures: [], warnings: [], skipped: 0, found: [], stopped: null, finished: false };
    const update = (next: Partial<Run>) => {
      state = { ...state, ...next };
      setRun(state);
    };
    update({});

    for (const t of targets) {
      if (stopRef.current) {
        update({ stopped: "Stopped. Companies already looked up keep their results." });
        break;
      }
      update({ current: `Reading ${t.name}…` });
      let body: EnrichResponse | null = null;
      let status = 0;
      try {
        const res = await fetch(`/api/companies/${t.id}/enrich`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ onlyNew: true }),
        });
        status = res.status;
        body = (await res.json().catch(() => null)) as EnrichResponse | null;
      } catch (e) {
        update({ stopped: `Couldn't reach the server (${(e as Error).message}). Check your connection, then tap Look up all again.` });
        break;
      }
      if (status === 401) {
        update({ stopped: body && !body.ok ? body.error : "You're signed out. Sign in again." });
        break;
      }
      if (!body) {
        update({ failures: [...state.failures, { ...t, text: `The server answered ${status} without a readable result.` }] });
      } else if (!body.ok) {
        update({ failures: [...state.failures, { ...t, text: body.error }] });
      } else if (body.skipped) {
        update({ skipped: state.skipped + 1 });
      } else if (body.notes.length > 0) {
        update({ warnings: [...state.warnings, { ...t, text: body.notes.join("\n") }] });
      }

      // Then founder research for the people just found (up to 3 searches).
      // Runs even when the site named no one: research then searches for the
      // founders first.
      if (body?.ok && !body.skipped && !stopRef.current) {
        update({ current: `Researching founders at ${t.name}…` });
        const found = await callCompanyApi<ResearchResponse>(`/api/companies/${t.id}/research`, { onlyNew: true });
        if (!found.ok) {
          update({ failures: [...state.failures, { ...t, text: `Founder research: ${found.error}` }] });
        } else if (found.found.length > 0 || found.leaders.length > 0) {
          const leaders = found.leaders.map((l) => `${t.name}: ${l.name} is ${l.title.toLowerCase()}`);
          update({ found: [...state.found, ...leaders, ...found.found.map((f) => `${t.name}: ${f}`)] });
        }
      }
      update({ done: state.done + 1 });
      // Show the new score and reasons as each one finishes.
      startRefresh(() => router.refresh());
    }
    update({ current: null, finished: true });
    runningRef.current = false;
  }

  if (loadError && !run) {
    return (
      <p role="alert" className="rounded-md bg-danger-surface px-4 py-3 text-base text-danger">
        {loadError}
      </p>
    );
  }
  if (pending.length === 0 && !run) return null;

  const total = run?.targets.length ?? pending.length;
  const label = `${pending.length} ${pending.length === 1 ? "company" : "companies"}`;

  return (
    <div className="flex flex-col gap-3">
      {!running && !confirming && pending.length > 0 && (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="min-h-14 rounded-lg border-2 border-foreground px-6 text-lg font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Look up all ({pending.length} not looked up)
        </button>
      )}

      {confirming && (
        <div className="flex flex-col gap-3 rounded-lg border-2 border-foreground p-4">
          <p className="text-base">
            This reads the website of {label} one at a time, asks Claude about each, and searches the web for its
            founders (1 search, when the site names none) and for where the people found went to school and are from (up
            to 3 more). That uses your API credit: roughly 2 to 5 cents a company, up to about $
            {(pending.length * 0.05).toFixed(2)} in all. Keep this page open while it runs.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={start}
              className="min-h-12 rounded-lg bg-accent px-4 text-base font-semibold text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Look up {label}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="min-h-12 rounded-lg border-2 border-foreground px-4 text-base font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {run && (
        <div className="flex flex-col gap-3 rounded-lg border-2 border-foreground p-4">
          <div role="status" aria-live="polite" className="flex flex-col gap-1">
            <p className="text-lg font-semibold tabular-nums">
              {run.done} of {total} done
            </p>
            {run.current && <p className="text-base text-muted wrap-anywhere">{run.current}</p>}
            {run.finished && !run.stopped && (
              <p className="text-base text-muted">
                {run.failures.length === 0
                  ? "All looked up."
                  : `Finished. ${run.failures.length} couldn’t be looked up; see below.`}
                {run.skipped > 0 &&
                  ` ${run.skipped} ${run.skipped === 1 ? "was" : "were"} already looked up elsewhere, so ${run.skipped === 1 ? "it was" : "they were"} skipped.`}
              </p>
            )}
          </div>
          <div
            aria-hidden
            className="h-2 overflow-hidden rounded-full bg-rule"
          >
            <div className="h-full bg-accent transition-[width] motion-reduce:transition-none" style={{ width: `${total ? (run.done / total) * 100 : 0}%` }} />
          </div>
          {running && (
            <button
              type="button"
              onClick={() => {
                stopRef.current = true;
              }}
              className="min-h-12 rounded-lg border-2 border-foreground px-4 text-base font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Stop after this one
            </button>
          )}
          {run.stopped && (
            <p role="alert" className="rounded-md bg-danger-surface px-4 py-3 text-base text-danger">
              {run.stopped}
            </p>
          )}
          {run.failures.length > 0 && <ProblemList problems={run.failures} tone="text-danger" />}
          {run.found.length > 0 && (
            <details>
              <summary className="flex min-h-12 cursor-pointer items-center text-base font-medium underline underline-offset-4">
                Founder research found {run.found.length} {run.found.length === 1 ? "fact" : "facts"}
              </summary>
              <ul className="flex flex-col gap-1 pb-2 text-base">
                {run.found.map((f, i) => (
                  <li key={i} className="wrap-anywhere">
                    {f}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {run.warnings.length > 0 && (
            <details>
              <summary className="flex min-h-12 cursor-pointer items-center text-base font-medium underline underline-offset-4">
                {run.warnings.length} looked up with notes
              </summary>
              <ProblemList problems={run.warnings} tone="text-muted" />
            </details>
          )}
          {run.finished && (
            <button
              type="button"
              onClick={() => setRun(null)}
              className="-ml-2 flex min-h-12 w-fit items-center px-2 text-base font-medium underline underline-offset-4"
            >
              Close
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ProblemList({ problems, tone }: { problems: Problem[]; tone: string }) {
  return (
    <ul className="flex flex-col divide-y divide-rule border-y border-rule">
      {problems.map((p) => (
        <li key={p.id} className="flex flex-col py-2">
          <a
            href={`/company/${p.id}`}
            className="flex min-h-12 items-center font-semibold underline underline-offset-4 wrap-anywhere"
          >
            {p.name}
          </a>
          <span className={`text-base ${tone} wrap-anywhere whitespace-pre-line`}>{p.text}</span>
        </li>
      ))}
    </ul>
  );
}
