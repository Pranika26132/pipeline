"use client";

export default function Error({ error, reset }: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-6 px-4 pt-14 pb-10 sm:pt-24">
      <h1 className="text-3xl font-bold tracking-[-0.03em]">This page couldn’t load</h1>
      <p role="alert" className="rounded-md bg-danger-surface px-4 py-3 text-base text-danger">
        {error.message}
        {error.digest && ` (error id ${error.digest})`}
      </p>
      <button
        type="button"
        onClick={reset}
        className="min-h-14 rounded-lg bg-accent px-6 text-lg font-semibold text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Try again
      </button>
      <a
        href="/login"
        className="flex min-h-12 items-center justify-center text-base font-medium underline underline-offset-4"
      >
        Go to sign in
      </a>
    </main>
  );
}
