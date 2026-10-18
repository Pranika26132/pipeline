"use client";

import { useActionState } from "react";

import { renameCompany, type RenameState } from "./actions";

// Optional: change the name Pipeline uses for the company in the list and
// in drafts. Closed by default; nothing waits on it.
export function RenameForm({ companyId, current }: { companyId: string; current: string }) {
  const [state, action, pending] = useActionState<RenameState, FormData>(async (prev, formData) => {
    try {
      return await renameCompany(companyId, prev, formData);
    } catch {
      return { error: "Couldn't reach the server, so the name wasn't saved. Try again." };
    }
  }, {});
  return (
    <details className="group mt-1" open={!!state.error}>
      <summary className="-ml-2 flex min-h-12 w-fit cursor-pointer list-none items-center px-2 text-base font-medium underline underline-offset-4 [&::-webkit-details-marker]:hidden">
        Edit name
      </summary>
    <form action={action} className="mt-2 flex flex-col gap-3 rounded-md border border-rule p-4">
      <label className="flex flex-col gap-2">
        <span className="text-base font-medium">Company name</span>
        <span className="text-sm text-muted">Used in your list and in drafts.</span>
        <input
          name="name"
          defaultValue={current}
          maxLength={200}
          autoComplete="off"
          className="min-h-12 w-full rounded-md border border-rule bg-field px-4 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
        />
      </label>
      <div aria-live="polite" className="empty:hidden">
        {state.error && (
          <p role="alert" className="rounded-md bg-danger-surface px-4 py-3 text-base text-danger">
            {state.error}
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="min-h-12 rounded-lg border-2 border-foreground px-5 text-base font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save name"}
      </button>
    </form>
    </details>
  );
}
