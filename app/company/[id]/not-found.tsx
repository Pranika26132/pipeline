import Link from "next/link";

import { TopBar } from "../../top-bar";

export default function CompanyNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 pt-6 pb-10 sm:pt-12">
      <TopBar back={false} />
      <h1 className="text-3xl font-bold tracking-[-0.03em]">That company isn’t in your list</h1>
      <p className="text-lg text-muted">It may have been deleted, or the link is wrong.</p>
      <Link
        href="/"
        className="flex min-h-14 items-center justify-center rounded-lg bg-accent px-6 text-lg font-semibold text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Back to your list
      </Link>
    </main>
  );
}
