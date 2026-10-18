import Link from "next/link";

const link = "flex min-h-12 items-center px-2 text-base font-medium underline underline-offset-4";

// The same bar on every signed-in page: back to the list on the left (except
// on the list itself), Profile in the top-right corner.
export function TopBar({ back = true, onProfile = false }: { back?: boolean; onProfile?: boolean }) {
  return (
    <nav aria-label="Pipeline" className="flex min-h-12 items-center justify-between gap-4">
      {back ? (
        <Link href="/" className={`-ml-2 ${link}`}>
          Back to your list
        </Link>
      ) : (
        <span />
      )}
      {onProfile ? (
        <span aria-current="page" className="-mr-2 flex min-h-12 items-center px-2 text-base font-semibold">
          Profile
        </span>
      ) : (
        <Link href="/profile" className={`-mr-2 shrink-0 ${link}`}>
          Profile
        </Link>
      )}
    </nav>
  );
}
