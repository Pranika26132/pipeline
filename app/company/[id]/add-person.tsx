"use client";

import { useActionState } from "react";

import { addPerson, type AddPersonState } from "./actions";

const field =
  "min-h-12 w-full rounded-md border border-rule bg-field px-4 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";

// Closed by default; opens to a short form. After an error it reopens with
// what was typed.
export function AddPersonForm({ companyId }: { companyId: string }) {
  const [state, formAction, pending] = useActionState<AddPersonState, FormData>(
    async (prev, formData) => {
      try {
        return await addPerson(companyId, prev, formData);
      } catch {
        return { submittedAt: Date.now(), error: "Couldn't reach the server, so no one was added. Try again." };
      }
    },
    {},
  );
  const v = state.error ? state.values : undefined;

  return (
    <details open={!!state.error || !!state.added} className="group rounded-lg border border-rule px-4" key={state.submittedAt ?? 0}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between text-base font-semibold [&::-webkit-details-marker]:hidden">
        Add a person
        <span aria-hidden className="text-xl leading-none transition-transform group-open:rotate-45 motion-reduce:transition-none">
          +
        </span>
      </summary>
      <form action={formAction} noValidate className="flex flex-col gap-4 pt-2 pb-4">
        <p className="text-base text-muted">Someone you know works here. What you type counts toward the score.</p>
        <Field label="Name" name="name" defaultValue={v?.name} autoComplete="off" required />
        <Field label="Title" name="title" defaultValue={v?.title} optional />
        <Field label="School" name="school" defaultValue={v?.school} optional />
        <Field label="Hometown" name="hometown" defaultValue={v?.hometown} optional />
        <Field label="Source link" name="source" type="url" inputMode="url" defaultValue={v?.source} optional hint="Where you saw this, if anywhere." />
        <Field label="Email" name="email" type="email" inputMode="email" defaultValue={v?.email} optional hint="Only one you know. Pipeline never guesses emails." />
        <div aria-live="polite" className="empty:hidden">
          {state.error && (
            <p role="alert" className="rounded-md bg-danger-surface px-4 py-3 text-base text-danger">
              {state.error}
            </p>
          )}
          {state.added && !state.error && !pending && (
            <p className="rounded-md border border-accent px-4 py-3 text-base">Added {state.added}.</p>
          )}
        </div>
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="min-h-12 rounded-lg bg-accent px-5 text-base font-semibold text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add person"}
        </button>
      </form>
    </details>
  );
}

function Field({
  label,
  hint,
  optional,
  ...input
}: { label: string; hint?: string; optional?: boolean } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-base font-medium">
        {label}
        {optional && <span className="font-normal text-muted"> (optional)</span>}
      </span>
      <input {...input} autoCapitalize={input.type === "url" || input.type === "email" ? "none" : undefined} spellCheck={false} className={field} />
      {hint && <span className="text-sm text-muted">{hint}</span>}
    </label>
  );
}
