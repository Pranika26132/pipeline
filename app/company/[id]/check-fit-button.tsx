"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { FitResponse } from "../../api/companies/[id]/fit/route";
import { callCompanyApi } from "./enrich-button";

// Asks Claude which open roles fit the profile (one short call, no search).
export function CheckFitButton({ companyId, label }: { companyId: string; label: string }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [note, setNote] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const busy = running || refreshing;

  async function run() {
    setRunning(true);
    setNote(null);
    const result = await callCompanyApi<FitResponse>(`/api/companies/${companyId}/fit`);
    setRunning(false);
    if (!result.ok) {
      setNote({ kind: "error", text: result.error });
      return;
    }
    setNote({
      kind: "info",
      text: `Checked ${result.roles} ${result.roles === 1 ? "role" : "roles"}: ${result.fits === 0 ? "none fit" : `${result.fits} ${result.fits === 1 ? "fits" : "fit"}`} your profile.`,
    });
    startRefresh(() => router.refresh());
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        aria-busy={busy}
        className="flex min-h-12 w-full items-center justify-center rounded-lg border-2 border-foreground px-4 text-base font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60 sm:w-fit"
      >
        {running ? "Checking fit…" : label}
      </button>
      <div aria-live="polite" className="empty:hidden">
        {note && (
          <p
            role={note.kind === "error" ? "alert" : undefined}
            className={note.kind === "error" ? "rounded-md bg-danger-surface px-4 py-3 text-base text-danger" : "text-base text-muted"}
          >
            {note.text}
          </p>
        )}
      </div>
    </div>
  );
}
