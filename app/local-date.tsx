"use client";

// Formats a timestamp in the viewer's own time zone. The server renders it in
// UTC first, so the text can change on hydration.
export function LocalDate({ iso }: { iso: string }) {
  const date = new Date(iso);
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
    </time>
  );
}
