"use client";

import { useRef, useState } from "react";

import { LIMITS } from "@/lib/profile";
import { RESUME_MAX_BYTES } from "@/lib/resume-limits";

import type { ResumeResponse } from "../api/profile/resume/route";

type Note = { kind: "error" | "info"; text: string } | null;

// The resume box. "Upload a PDF" reads the text out of a PDF and fills the
// box for review; nothing is saved until Save profile, and only the text.
export function ResumeField({ initial, fieldClass }: { initial: string; fieldClass: string }) {
  const [text, setText] = useState(initial);
  const [previous, setPrevious] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const input = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setNote(null);
    setPrevious(null);
    // The same checks run on the server; these just answer faster.
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
      setNote({ kind: "error", text: "That file isn't a PDF. Upload your resume as a PDF, or paste it." });
      return;
    }
    if (file.size > RESUME_MAX_BYTES) {
      setNote({
        kind: "error",
        text: `That PDF is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 4 MB; export a smaller PDF, or paste your resume.`,
      });
      return;
    }
    setReading(true);
    const body = new FormData();
    body.append("resume", file);
    let result: ResumeResponse;
    try {
      const res = await fetch("/api/profile/resume", { method: "POST", body });
      result =
        ((await res.json().catch(() => null)) as ResumeResponse | null) ??
        (res.status === 413
          ? { ok: false, error: "That PDF is over the 4 MB limit. Export a smaller PDF, or paste your resume." }
          : { ok: false, error: `The server answered ${res.status} without a readable result. Try again.` });
    } catch (e) {
      result = { ok: false, error: `Couldn't reach the server (${(e as Error).message}). Check your connection.` };
    }
    setReading(false);
    if (!result.ok) {
      setNote({ kind: "error", text: result.error });
      return;
    }
    if (text.trim()) setPrevious(text);
    setText(result.text);
    setNote({
      kind: "info",
      text: `Read from ${file.name}.${result.truncated ? " It was long, so only the first part was kept." : ""} Check the text, fix anything that came out wrong, then save your profile. The PDF itself isn’t kept.`,
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-2">
        <span className="flex items-baseline justify-between gap-3 text-base font-medium">
          Resume <span className="text-sm font-normal text-muted tabular-nums">{text.length.toLocaleString("en-US")} / {LIMITS.resume.toLocaleString("en-US")}</span>
        </span>
        <textarea
          name="resume"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          maxLength={LIMITS.resume}
          aria-busy={reading}
          className={`${fieldClass} py-3 leading-relaxed`}
        />
      </label>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void upload(file);
        }}
      />
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={reading}
          aria-busy={reading}
          className="flex min-h-12 items-center justify-center rounded-lg border-2 border-foreground px-4 text-base font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
        >
          {reading ? "Reading the PDF…" : "Upload a PDF"}
        </button>
        {previous !== null && !reading && (
          <button
            type="button"
            onClick={() => {
              setText(previous);
              setPrevious(null);
              setNote(null);
            }}
            className="-ml-2 flex min-h-12 items-center px-2 text-base font-medium underline underline-offset-4"
          >
            Undo, keep what I had
          </button>
        )}
      </div>
      <p className="text-sm text-muted">Paste it, or upload a PDF up to 4 MB. Only the text is saved.</p>
      <div aria-live="polite" className="empty:hidden">
        {note && (
          <p
            role={note.kind === "error" ? "alert" : undefined}
            className={
              note.kind === "error"
                ? "rounded-md bg-danger-surface px-4 py-3 text-base text-danger"
                : "rounded-md border border-accent px-4 py-3 text-base wrap-anywhere"
            }
          >
            {note.text}
          </p>
        )}
      </div>
    </div>
  );
}
