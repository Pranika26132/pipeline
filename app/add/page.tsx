import type { Metadata } from "next";
import Link from "next/link";

import { AddCsvForm, AddLinkForm } from "./add-forms";

export const metadata: Metadata = {
  title: "Add companies · Pipeline",
};

export default function AddPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col px-4 pt-6 pb-16 sm:pt-12">
      <Link
        href="/"
        className="-ml-2 flex min-h-12 w-fit items-center px-2 text-base font-medium underline underline-offset-4"
      >
        Back to your list
      </Link>
      <h1 className="mt-6 text-4xl font-bold tracking-[-0.04em]">Add companies</h1>

      <section aria-labelledby="add-link" className="mt-8 flex flex-col gap-4">
        <h2 id="add-link" className="text-xl font-semibold">
          One company
        </h2>
        <AddLinkForm />
      </section>

      <section aria-labelledby="add-csv" className="mt-12 flex flex-col gap-4 border-t-2 border-foreground pt-8">
        <h2 id="add-csv" className="text-xl font-semibold">
          A list from a spreadsheet
        </h2>
        <AddCsvForm />
      </section>
    </main>
  );
}
