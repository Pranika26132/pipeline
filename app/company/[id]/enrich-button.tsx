"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { EnrichResponse } from "../../api/companies/[id]/enrich/route";
import type { ResearchResponse } from "../../api/companies/[id]/research/route";

type Status =
  | { kind: "idle" }
  | { kind: "running"; step: "lookup" | "research" }
  | { kind: "done"; lines: string[] }
  | { kind: "error"; text: string; lines?: string[] };

// Posts to one of the company API routes; a network failure or unreadable
// answer becomes an { ok: false } result with a message to show.
export async function callCompanyApi<T extends { ok: boolean }>(
  url: string,
  body?: unknown,
): Promise<T | { ok: false; error: string; status: number }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => null)) as T | null;
    if (!json) return { ok: false, status: res.status, error: `The server answered ${res.status} without a readable result. Try again.` };
    return json;
  } catch (e) {
    return { ok: false, status: 0, error: `Couldn't reach the server (${(e as Error).message}). Check your connection.` };
  }
}

export function researchSummary(r: Extract<ResearchResponse, { ok: true }>): string[] {
  if (r.searches === 0 && r.people === 0) return r.notes;
  const searched = `Searched the web ${r.searches} ${r.searches === 1 ? "time" : "times"}.`;
  const leaders = r.leaders.map((l) => `Found ${l.title.toLowerCase()}: ${l.name} (on ${hostOf(l.url)})`);
  const found = r.found.map((f) => `Found: ${f}`);
  return [searched, ...leaders, ...found, ...r.notes];
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "a web page";
  }
}

export function EnrichButton({ companyId, domain, looked }: { companyId: string; domain: string; looked: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [refreshing, startRefresh] = useTransition();
  const busy = status.kind === "running" || refreshing;

  async function run() {
    setStatus({ kind: "running", step: "lookup" });
    const lookup = await callCompanyApi<EnrichResponse>(`/api/companies/${companyId}/enrich`);
    if (!lookup.ok) {
      setStatus({ kind: "error", text: lookup.error });
      // Errors are saved on the company too, so refresh either way.
      startRefresh(() => router.refresh());
      return;
    }
    const people = lookup.people === 1 ? "1 person" : `${lookup.people} people`;
    const roles = lookup.roles === 1 ? "1 open role" : `${lookup.roles} open roles`;
    const lines = [`Found ${people} and ${roles}.`];

    // Then look for each person's school and hometown on other public pages.
    // A repeat lookup that found no one new doesn't search again (each run
    // costs up to 3 searches); "Research founders" is the way to retry.
    setStatus({ kind: "running", step: "research" });
    const found = await callCompanyApi<ResearchResponse>(
      `/api/companies/${companyId}/research`,
      lookup.newPeople > 0 ? undefined : { onlyNew: true },
    );
    if (!found.ok) setStatus({ kind: "error", text: found.error, lines });
    else if (found.skipped) {
      setStatus({
        kind: "done",
        lines: [...lines, "No one new, so founder research didn't run again. Tap Research founders to search again."],
      });
    } else setStatus({ kind: "done", lines: [...lines, ...researchSummary(found)] });
    startRefresh(() => router.refresh());
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        aria-busy={busy}
        className="min-h-14 rounded-lg bg-accent px-6 text-lg font-semibold text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
      >
        {status.kind === "running"
          ? status.step === "lookup"
            ? `Reading ${domain}…`
            : "Researching founders…"
          : looked
            ? "Look up again"
            : "Look up company"}
      </button>
      <div aria-live="polite" className="empty:hidden">
        {status.kind === "running" && (
          <p className="text-base text-muted">
            {status.step === "lookup"
              ? "Reading the home, about, team and careers pages. This can take up to a minute."
              : "Searching public pages (never LinkedIn) for where the people found went to school and are from."}
          </p>
        )}
        {status.kind === "done" && <Lines lines={status.lines} className="rounded-md border border-accent px-4 py-3" />}
        {status.kind === "error" && (
          <div className="flex flex-col gap-2">
            {status.lines && <Lines lines={status.lines} className="rounded-md border border-accent px-4 py-3" />}
            <p role="alert" className="rounded-md bg-danger-surface px-4 py-3 text-base text-danger whitespace-pre-line">
              {status.text}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// Re-runs only the founder research, e.g. after adding a person by hand.
export function ResearchButton({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [refreshing, startRefresh] = useTransition();
  const busy = status.kind === "running" || refreshing;

  async function run() {
    setStatus({ kind: "running", step: "research" });
    const found = await callCompanyApi<ResearchResponse>(`/api/companies/${companyId}/research`);
    setStatus(found.ok ? { kind: "done", lines: researchSummary(found) } : { kind: "error", text: found.error });
    startRefresh(() => router.refresh());
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        aria-busy={busy}
        className="min-h-12 rounded-lg border-2 border-foreground px-5 text-base font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
      >
        {status.kind === "running" ? "Researching founders…" : "Research founders"}
      </button>
      <div aria-live="polite" className="empty:hidden">
        {status.kind === "done" && <Lines lines={status.lines} className="rounded-md border border-accent px-4 py-3" />}
        {status.kind === "error" && (
          <p role="alert" className="rounded-md bg-danger-surface px-4 py-3 text-base text-danger whitespace-pre-line">
            {status.text}
          </p>
        )}
      </div>
    </div>
  );
}

function Lines({ lines, className }: { lines: string[]; className: string }) {
  return (
    <ul className={`flex flex-col gap-1 text-base ${className}`}>
      {lines.map((l, i) => (
        <li key={i} className="wrap-anywhere">
          {l}
        </li>
      ))}
    </ul>
  );
}
