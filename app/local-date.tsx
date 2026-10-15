"use client";

// Formats a timestamp in the viewer's own time zone. The server renders it in
// UTC first, so the text can change on hydration.
export function LocalDate({ iso, withTime = false }: { iso: string; withTime?: boolean }) {
  const date = new Date(iso);
  const day = date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const time = withTime ? ` at ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : "";
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {day}
      {time}
    </time>
  );
}
