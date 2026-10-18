"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";

import { GMAIL_URL_LIMIT, gmailComposeUrl, HOOKS, MAX_WORDS, STOCK_PHRASES, wordCount, type Hook } from "@/lib/drafts";

import type { DraftResponse } from "../../api/companies/[id]/draft/route";
import { saveEditedDraft, type SaveDraftState } from "./actions";
import { callCompanyApi } from "./enrich-button";

type Person = { id: string; name: string; title: string | null; email: string | null };

const field =
  "min-h-12 w-full rounded-md border border-rule bg-field px-4 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";
const secondary =
  "flex min-h-12 items-center justify-center rounded-lg border-2 border-foreground px-4 text-base font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60";

// Writes, edits and hands off a draft. Pipeline never sends email: "Open in
// Gmail" fills a compose window the user sends themselves.
export function DraftPanel({
  companyId,
  people,
  hooks,
  saved,
}: {
  companyId: string;
  people: Person[];
  hooks: Exclude<Hook, "auto">[];
  saved: { subject: string; body: string; contactId: string | null } | null;
}) {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  // "" means the team. A saved team draft stays addressed to the team.
  const [contactId, setContactId] = useState(saved ? (saved.contactId ?? "") : (people[0]?.id ?? ""));
  // Who the current draft was written to; the dropdown only picks the next one.
  const [draftContactId, setDraftContactId] = useState(saved ? (saved.contactId ?? "") : "");
  const [hasDraft, setHasDraft] = useState(!!saved);
  const [hook, setHook] = useState<Hook>("auto");
  const [subject, setSubject] = useState(saved?.subject ?? "");
  const [body, setBody] = useState(saved?.body ?? "");
  const [writing, setWriting] = useState(false);
  const [note, setNote] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [saveState, saveAction, saving] = useActionState<SaveDraftState, FormData>(
    async (prev, formData) => {
      try {
        return await saveEditedDraft(companyId, prev, formData);
      } catch {
        return { error: "Couldn't reach the server, so the draft wasn't saved. Try again." };
      }
    },
    {},
  );

  const recipient = people.find((p) => p.id === draftContactId) ?? null;
  const pickedOther = hasDraft && contactId !== draftContactId;
  const words = wordCount(body);
  const gmailUrl = gmailComposeUrl({ to: recipient?.email, subject, body });
  const lower = `${subject}\n${body}`.toLowerCase().replace(/[’]/g, "'");
  const stock = STOCK_PHRASES.filter((p) => lower.includes(p));

  async function write() {
    setWriting(true);
    setNote(null);
    const result = await callCompanyApi<DraftResponse>(`/api/companies/${companyId}/draft`, { contactId: contactId || null, hook });
    setWriting(false);
    if (!result.ok) {
      setNote({ kind: "error", text: result.error });
      return;
    }
    setSubject(result.subject);
    setBody(result.body);
    setDraftContactId(result.contactId ?? "");
    setHasDraft(true);
    setNote(
      result.warning
        ? { kind: "error", text: `${result.warning} Use Save changes to try again, or Copy it.` }
        : { kind: "info", text: `${result.toTeam ? "No one picked, so it's written to the team. " : ""}Uses: ${result.fact}` },
    );
    startRefresh(() => router.refresh());
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setNote({ kind: "error", text: "Couldn't copy. Select the text and copy it by hand." });
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-2">
          <span className="text-base font-medium">To</span>
          <select value={contactId} onChange={(e) => setContactId(e.target.value)} className={field}>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.title ? `, ${p.title}` : ""}
              </option>
            ))}
            <option value="">The team</option>
          </select>
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-base font-medium">Lead with</span>
          <select value={hook} onChange={(e) => setHook(e.target.value as Hook)} className={field}>
            {HOOKS.filter((h) => h.value === "auto" || hooks.includes(h.value)).map((h) => (
              <option key={h.value} value={h.value}>
                {h.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button
        type="button"
        onClick={write}
        disabled={writing}
        aria-busy={writing}
        className="min-h-14 rounded-lg bg-accent px-6 text-lg font-semibold text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
      >
        {writing ? "Writing…" : body ? "Write a new draft" : "Write a draft"}
      </button>
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

      {hasDraft && (
        <form action={saveAction} className="flex flex-col gap-4">
          <input type="hidden" name="contactId" value={draftContactId} />
          {pickedOther && (
            <p className="rounded-md border border-rule px-4 py-3 text-base">
              This draft is to {recipient ? recipient.name : "the team"}. Write a new draft to change who it’s to.
            </p>
          )}
          <label className="flex flex-col gap-2">
            <span className="text-base font-medium">Subject</span>
            <input name="subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} className={field} />
          </label>
          <label className="flex flex-col gap-2">
            <span className="flex items-baseline justify-between gap-3 text-base font-medium">
              Email
              <span className={`text-sm tabular-nums ${words >= MAX_WORDS ? "font-semibold text-danger" : "text-muted"}`}>
                {words} {words === 1 ? "word" : "words"} (keep under {MAX_WORDS})
              </span>
            </span>
            <textarea
              name="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={11}
              maxLength={5000}
              className={`${field} py-3 leading-relaxed`}
            />
          </label>
          {stock.length > 0 && (
            <p className="rounded-md border border-danger px-4 py-3 text-base">
              Stock phrases to cut: {stock.map((p) => `“${p}”`).join(", ")}.
            </p>
          )}
          <div aria-live="polite" className="empty:hidden">
            {saveState.error && (
              <p role="alert" className="rounded-md bg-danger-surface px-4 py-3 text-base text-danger">
                {saveState.error}
              </p>
            )}
            {saveState.savedAt && !saveState.error && !saving && <p className="text-base text-muted">Draft saved.</p>}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <button type="submit" disabled={saving} aria-busy={saving} className={secondary}>
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button type="button" onClick={copy} className={secondary}>
              {copied ? "Copied" : "Copy"}
            </button>
            {gmailUrl.length <= GMAIL_URL_LIMIT ? (
              <a href={gmailUrl} target="_blank" rel="noopener noreferrer" className={secondary}>
                Open in Gmail
              </a>
            ) : (
              <p className="flex min-h-12 items-center justify-center rounded-lg border border-rule px-4 text-center text-sm text-muted">
                Too long for a Gmail link; use Copy.
              </p>
            )}
          </div>
          <p className="text-sm text-muted">
            Pipeline never sends email. Gmail opens a draft
            {recipient?.email ? ` to ${recipient.email}` : " with no address (Pipeline never guesses emails)"}; you review
            and send it yourself.
          </p>
        </form>
      )}
    </div>
  );
}
