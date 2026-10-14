"use client";

import { useActionState, useState } from "react";

import { authenticate, type AuthFormState, type AuthMode } from "./actions";

const MODES: { value: AuthMode; label: string; submit: string; pending: string }[] = [
  { value: "signin", label: "Sign in", submit: "Sign in", pending: "Signing in…" },
  { value: "signup", label: "Create account", submit: "Create account", pending: "Creating account…" },
];

export function LoginForm({ initialError }: { initialError?: string }) {
  const [mode, setMode] = useState<AuthMode>("signin");
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    authenticate,
    { error: initialError },
  );
  const current = MODES.find((m) => m.value === mode)!;
  // Hide a message from the other tab once the user switches modes.
  const showMessage = !state.mode || state.mode === mode;

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <div
        role="group"
        aria-label="Choose sign in or create account"
        className="grid grid-cols-2 rounded-lg border border-rule p-1"
      >
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            aria-pressed={mode === m.value}
            onClick={() => setMode(m.value)}
            disabled={pending}
            className="min-h-12 rounded-md text-base font-medium text-muted transition-colors aria-pressed:bg-foreground aria-pressed:text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
          >
            {m.label}
          </button>
        ))}
      </div>

      <input type="hidden" name="mode" value={mode} />

      <label className="flex flex-col gap-2">
        <span className="text-base font-medium">Email</span>
        <input
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          defaultValue={state.email}
          className="min-h-12 rounded-md border border-rule bg-field px-4 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
        />
      </label>

      <label className="flex flex-col gap-2">
        <span className="text-base font-medium">Password</span>
        <input
          name="password"
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          required
          className="min-h-12 rounded-md border border-rule bg-field px-4 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
        />
      </label>

      <div aria-live="polite" className="empty:hidden">
        {showMessage && state.error && (
          <p role="alert" className="rounded-md bg-danger-surface px-4 py-3 text-base text-danger">
            {state.error}
          </p>
        )}
        {showMessage && state.notice && (
          <p className="rounded-md border border-accent px-4 py-3 text-base">{state.notice}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="mt-1 min-h-14 rounded-lg bg-accent px-6 text-lg font-semibold text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-70"
      >
        {pending ? current.pending : current.submit}
      </button>
    </form>
  );
}
