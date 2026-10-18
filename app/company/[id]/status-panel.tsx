"use client";

import { useActionState, useState } from "react";

import { STATUSES } from "@/lib/list-filters";

import { saveStatus, type StatusState } from "./actions";

// Where things stand with this company, and when to follow up.
export function StatusPanel({
  companyId,
  status,
  followUpOn,
  sentAt,
}: {
  companyId: string;
  status: string;
  followUpOn: string | null;
  sentAt: string | null;
}) {
  const [picked, setPicked] = useState(status);
  const [date, setDate] = useState(followUpOn ?? "");
  const [state, action, pending] = useActionState<StatusState, FormData>(async (prev, formData) => {
    try {
      return await saveStatus(companyId, prev, formData);
    } catch {
      return { error: "Couldn't reach the server, so the status wasn't saved. Try again." };
    }
  }, {});
  const changed = picked !== status || date !== (followUpOn ?? "");

  return (
    <form action={action} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-base font-medium">Status</legend>
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <label
              key={s.value}
              className="flex min-h-11 cursor-pointer items-center rounded-full border border-rule bg-field px-4 text-base has-[:checked]:border-accent has-[:checked]:bg-accent has-[:checked]:font-semibold has-[:checked]:text-accent-foreground has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
            >
              <input
                type="radio"
                name="status"
                value={s.value}
                checked={picked === s.value}
                onChange={() => setPicked(s.value)}
                className="sr-only"
              />
              {s.label}
            </label>
          ))}
        </div>
      </fieldset>
      {sentAt && (
        <p className="text-base text-muted">
          Marked sent on {new Date(sentAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}.
        </p>
      )}
      <label className="flex flex-col gap-2">
        <span className="text-base font-medium">
          Follow up on <span className="font-normal text-muted">(optional)</span>
        </span>
        <span className="flex gap-2">
          <input
            type="date"
            name="followUpOn"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="min-h-12 w-full max-w-60 rounded-md border border-rule bg-field px-4 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
          {date && (
            <button
              type="button"
              onClick={() => setDate("")}
              className="flex min-h-12 items-center px-3 text-base font-medium underline underline-offset-4"
            >
              Clear
            </button>
          )}
        </span>
      </label>
      <div aria-live="polite" className="empty:hidden">
        {state.error && (
          <p role="alert" className="rounded-md bg-danger-surface px-4 py-3 text-base text-danger">
            {state.error}
          </p>
        )}
        {state.savedAt && !state.error && !pending && !changed && <p className="text-base text-muted">Status saved.</p>}
      </div>
      <button
        type="submit"
        disabled={pending || !changed}
        aria-busy={pending}
        className="min-h-12 rounded-lg bg-accent px-5 text-base font-semibold text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save status"}
      </button>
    </form>
  );
}
