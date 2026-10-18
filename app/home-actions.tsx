"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { FindCompanies } from "./find-companies";

const base =
  "flex min-h-14 items-center justify-center rounded-lg px-3 text-center text-lg leading-tight font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

// The two ways to add to the list, side by side. "Find companies" opens the
// search box under them; it stays mounted once opened, so closing and
// reopening keeps the request and the results.
export function HomeActions() {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Link href="/add" className={`${base} bg-accent text-accent-foreground`}>
          Add companies
        </Link>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="find-panel"
          onClick={() => {
            setOpen(!open);
            setOpened(true);
          }}
          className={`${base} border-2 ${open ? "border-accent bg-field" : "border-foreground"}`}
        >
          Find companies
        </button>
      </div>
      {opened && (
        <div id="find-panel" hidden={!open}>
          <FindCompanies inputRef={input} />
        </div>
      )}
    </div>
  );
}
