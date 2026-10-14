"use client";

import { useActionState, useState } from "react";

import { addFromCsv, addFromUrl, type AddState, type RowOutcome } from "./actions";
import { CSV_MAX_BYTES } from "./limits";

const field =
  "min-h-12 rounded-md border border-rule bg-field px-4 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";
const primary =
  "min-h-14 rounded-lg bg-accent px-6 text-lg font-semibold text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60";
const alert = "rounded-md bg-danger-surface px-4 py-3 text-base text-danger";

export function AddLinkForm() {
  const [state, formAction, pending] = useActionState<AddState, FormData>(addFromUrl, {});
  const row = state.rows?.[0];

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <label className="flex flex-col gap-2">
        <span className="text-base font-medium">Website</span>
        <input
          name="url"
          type="url"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="acme.com"
          required
          defaultValue={state.url}
          key={`url-${state.submittedAt}`}
          className={field}
        />
      </label>
      <label className="flex flex-col gap-2">
        <span className="text-base font-medium">
          Name <span className="font-normal text-muted">(optional, defaults to the domain)</span>
        </span>
        <input
          name="name"
          autoComplete="off"
          defaultValue={state.name}
          key={`name-${state.submittedAt}`}
          className={field}
        />
      </label>

      <div aria-live="polite" className="empty:hidden">
        {state.error && (
          <p role="alert" className={alert}>
            {state.error}
          </p>
        )}
        {row?.status === "added" && (
          <p className="rounded-md border border-accent px-4 py-3 text-base">
            Added <span className="font-semibold">{row.domain}</span> to your list.
          </p>
        )}
        {row?.status === "duplicate" && (
          <p role="alert" className={alert}>
            {row.message} Nothing was added.
          </p>
        )}
      </div>

      <button type="submit" disabled={pending} aria-busy={pending} className={primary}>
        {pending ? "Adding…" : "Add company"}
      </button>
    </form>
  );
}

export function AddCsvForm() {
  const [state, formAction, pending] = useActionState<AddState, FormData>(addFromCsv, {});
  const [fileError, setFileError] = useState<string>();
  // Picking a new file hides the result of the last import.
  const [staleAt, setStaleAt] = useState<number>();
  const current = state.submittedAt !== staleAt;

  function checkFile(e: React.ChangeEvent<HTMLInputElement>) {
    setStaleAt(state.submittedAt);
    const file = e.target.files?.[0];
    if (file && file.size > CSV_MAX_BYTES) {
      setFileError(
        `That file is ${Math.ceil(file.size / 1024)} KB. The limit is ${CSV_MAX_BYTES / 1024} KB; split it into smaller files.`,
      );
    } else {
      setFileError(undefined);
    }
  }

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <label className="flex flex-col gap-2">
        <span className="text-base font-medium">CSV file</span>
        <span className="text-base text-muted">
          First row must name the columns. Needs <code className="font-semibold text-foreground">name</code> and{" "}
          <code className="font-semibold text-foreground">url</code>; other columns are ignored.
        </span>
        <input
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          onChange={checkFile}
          className="min-h-12 rounded-md border border-dashed border-rule bg-field px-3 py-3 text-base file:mr-4 file:min-h-10 file:rounded-md file:border-0 file:bg-foreground file:px-4 file:font-semibold file:text-background"
        />
      </label>

      <div aria-live="polite" className="empty:hidden">
        {(fileError ?? (current && state.error)) && (
          <p role="alert" className={alert}>
            {fileError ?? state.error}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={pending || !!fileError}
        aria-busy={pending}
        className={primary}
      >
        {pending ? "Importing…" : "Import companies"}
      </button>

      {state.rows && current && !fileError && <ImportReport rows={state.rows} />}
    </form>
  );
}

const VERDICT: Record<RowOutcome["status"], string> = {
  added: "Added",
  duplicate: "Already saved",
  skipped: "Skipped",
};

function ImportReport({ rows }: { rows: RowOutcome[] }) {
  const added = rows.filter((r) => r.status === "added");
  const problems = rows.filter((r) => r.status !== "added");
  const dupes = problems.filter((r) => r.status === "duplicate").length;
  const skipped = problems.length - dupes;

  return (
    <section aria-label="Import results" className="flex flex-col gap-4 border-t border-rule pt-5">
      <p className="text-lg">
        <span className="font-semibold">{added.length} added.</span>{" "}
        {dupes > 0 && `${dupes} already in your list. `}
        {skipped > 0 && `${skipped} skipped.`}
      </p>
      {problems.length > 0 && <Ledger rows={problems} />}
      {added.length > 0 && problems.length > 0 && (
        <details className="group">
          <summary className="flex min-h-12 cursor-pointer items-center text-base font-medium underline underline-offset-4">
            Show the {added.length} added
          </summary>
          <Ledger rows={added} />
        </details>
      )}
    </section>
  );
}

function Ledger({ rows }: { rows: RowOutcome[] }) {
  return (
    <ul className="flex flex-col divide-y divide-rule border-y border-rule">
      {rows.map((r, i) => (
        <li key={`${r.line}-${i}`} className="grid grid-cols-[3rem_1fr] gap-x-3 py-3">
          <span className="pt-0.5 text-sm tabular-nums text-muted">{r.line ? `#${r.line}` : ""}</span>
          <div className="min-w-0">
            <p className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="font-semibold wrap-anywhere">{r.label}</span>
              <span
                className={`text-sm font-medium ${r.status === "added" ? "text-accent" : r.status === "skipped" ? "text-danger" : "text-muted"}`}
              >
                {VERDICT[r.status]}
              </span>
            </p>
            {r.status !== "added" && <p className="mt-1 text-base text-muted">{r.message}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}
