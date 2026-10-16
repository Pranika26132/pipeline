"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { EnrichResponse } from "../../api/companies/[id]/enrich/route";

type Status = { kind: "idle" } | { kind: "running" } | { kind: "done"; text: string } | { kind: "error"; text: string };

export function EnrichButton({ companyId, domain, looked }: { companyId: string; domain: string; looked: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [refreshing, startRefresh] = useTransition();
  const busy = status.kind === "running" || refreshing;

  async function run() {
    setStatus({ kind: "running" });
    let message: Status;
    try {
      const res = await fetch(`/api/companies/${companyId}/enrich`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as EnrichResponse | null;
      if (!body) {
        message = { kind: "error", text: `The server answered ${res.status} without a readable result. Try again.` };
      } else if (!body.ok) {
        message = { kind: "error", text: body.error };
      } else {
        const people = body.people === 1 ? "1 person" : `${body.people} people`;
        const roles = body.roles === 1 ? "1 open role" : `${body.roles} open roles`;
        message = { kind: "done", text: `Found ${people} and ${roles}.` };
      }
    } catch (e) {
      message = { kind: "error", text: `Couldn't reach the server (${(e as Error).message}). Check your connection.` };
    }
    setStatus(message);
    // Errors are saved on the company too, so refresh either way.
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
        {status.kind === "running" ? `Reading ${domain}…` : looked ? "Look up again" : "Look up company"}
      </button>
      <div aria-live="polite" className="empty:hidden">
        {status.kind === "running" && (
          <p className="text-base text-muted">Reading the home, about, team and careers pages. This can take up to a minute.</p>
        )}
        {status.kind === "done" && <p className="rounded-md border border-accent px-4 py-3 text-base">{status.text}</p>}
        {status.kind === "error" && (
          <p role="alert" className="rounded-md bg-danger-surface px-4 py-3 text-base text-danger">
            {status.text}
          </p>
        )}
      </div>
    </div>
  );
}
