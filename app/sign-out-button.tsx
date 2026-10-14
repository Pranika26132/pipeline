"use client";

import { useActionState } from "react";

import { signOut, type SignOutState } from "./actions";

export function SignOutButton() {
  const [state, formAction, pending] = useActionState<SignOutState>(signOut, {});

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="min-h-14 rounded-lg border-2 border-foreground px-6 text-lg font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
      {state.error && (
        <p role="alert" className="rounded-md bg-danger-surface px-4 py-3 text-base text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
