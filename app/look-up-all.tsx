"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import type { EnrichResponse } from "./api/companies/[id]/enrich/route";

type Target = { id: string; name: string };
type Failure = { id: string; name: string; error: string };
type Run = { targets: Target[]; done: number; current: string | null; failures: Failure[]; stopped: string | null; finished: boolean };

// Looks up every company that hasn't been looked up, one at a time, through
// the same route as the button on a company page (so its checks and the
// one-minute wait apply). Runs while this page is open.
export function LookUpAll({ pending }: { pending: Target[] }) {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const stopRef = useRef(false);

  // Leaving the page stops the run after the current lookup.
  useEffect(() => () => void (stopRef.current = true), []);

  const running = run !== null && !run.finished;

  async function start() {
    setConfirming(false);
    stopRef.current = false;
    // A snapshot: the list refreshes during the run, but these are the targets.
    const targets = pending;
    let state: Run = { targets, done: 0, current: null, failures: [], stopped: null, finished: false };
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
      update({ current: t.name });
      let body: EnrichResponse | null = null;
      let status = 0;
      try {
        const res = await fetch(`/api/companies/${t.id}/enrich`, { method: "POST" });
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
        update({ failures: [...state.failures, { ...t, error: `The server answered ${status} without a readable result.` }] });
      } else if (!body.ok) {
        update({ failures: [...state.failures, { ...t, error: body.error }] });
      }
      update({ done: state.done + 1 });
      // Show the new score and reasons as each one finishes.
      startRefresh(() => router.refresh());
    }
    update({ current: null, finished: true });
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
            This reads the website of {label} one at a time and asks Claude about each, which uses your API credit. Keep
            this page open while it runs.
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
            {run.current && <p className="text-base text-muted wrap-anywhere">Reading {run.current}…</p>}
            {run.finished && !run.stopped && (
              <p className="text-base text-muted">
                {run.failures.length === 0
                  ? "All looked up."
                  : `Finished. ${run.failures.length} couldn’t be looked up; see below.`}
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
          {run.failures.length > 0 && (
            <ul className="flex flex-col divide-y divide-rule border-y border-rule">
              {run.failures.map((f) => (
                <li key={f.id} className="flex flex-col gap-1 py-3">
                  <a href={`/company/${f.id}`} className="font-semibold underline underline-offset-4 wrap-anywhere">
                    {f.name}
                  </a>
                  <span className="text-base text-danger wrap-anywhere whitespace-pre-line">{f.error}</span>
                </li>
              ))}
            </ul>
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
