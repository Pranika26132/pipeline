"use client";

import { useSyncExternalStore } from "react";

// "Follow up today", "Follow up (overdue)" or "Follow up Oct 21", judged by
// the viewer's own date, so it's right in their time zone.
export function FollowUpBadge({ date }: { date: string }) {
  // The viewer's local date as YYYY-MM-DD; empty while rendering on the server.
  const today = useSyncExternalStore(
    () => () => {},
    () => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    },
    () => "",
  );
  const [y, m, d] = date.split("-").map(Number);
  const label = new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (!today) return <span className="rounded-sm border border-rule px-2 py-0.5 text-sm text-muted">Follow up {label}</span>;
  const due = date <= today;
  return (
    <span
      className={
        due
          ? "rounded-sm border border-accent bg-accent px-2 py-0.5 text-sm font-semibold text-accent-foreground"
          : "rounded-sm border border-rule px-2 py-0.5 text-sm text-muted"
      }
    >
      {date === today ? "Follow up today" : due ? `Follow up (was ${label})` : `Follow up ${label}`}
    </span>
  );
}
