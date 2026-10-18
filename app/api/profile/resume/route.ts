import Anthropic from "@anthropic-ai/sdk";
import type { NextRequest } from "next/server";

import { describeModelError } from "@/lib/enrich/errors";
import { BadModelOutputError } from "@/lib/enrich/extract";
import { API_KEY_MESSAGE, isWellFormedApiKey, redactSecrets } from "@/lib/redact";
import { checkUpload, readResumePdf, RESUME_MAX_BYTES } from "@/lib/resume";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

export type ResumeResponse = { ok: true; text: string; truncated: boolean } | { ok: false; error: string };

function fail(status: number, error: string) {
  const safe = redactSecrets(error, [process.env.ANTHROPIC_API_KEY]);
  return Response.json({ ok: false, error: safe } satisfies ResumeResponse, { status });
}

// Reads the text out of an uploaded resume PDF and returns it for review.
// Nothing is saved here: the text is saved with the profile, the PDF never.
export async function POST(req: NextRequest) {
  // Only our own pages may trigger this: each read costs money.
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let originHost: string | null = null;
  try {
    originHost = origin ? new URL(origin).host : null;
  } catch {
    // "null" or a malformed Origin header; rejected below.
  }
  if (!originHost || !host || originHost !== host) return fail(403, "This request didn't come from Pipeline.");

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError) return fail(401, `Your session couldn't be checked (${authError.message}). Sign in again.`);
  if (!auth?.claims) return fail(401, "You're signed out. Sign in again.");

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!isWellFormedApiKey(apiKey)) return fail(500, API_KEY_MESSAGE);

  // Refuse an oversized body before reading it (form overhead allowed).
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > RESUME_MAX_BYTES + 64 * 1024) return fail(413, "That PDF is over the 4 MB limit. Export a smaller PDF, or paste your resume.");

  let file: FormDataEntryValue | null;
  try {
    file = (await req.formData()).get("resume");
  } catch {
    return fail(400, "The upload didn't arrive in one piece. Try again.");
  }
  if (!(file instanceof File)) return fail(400, "Choose a PDF to upload.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const problem = checkUpload(file, bytes);
  if (problem) return fail(problem.includes("limit") ? 413 : 415, problem);

  try {
    const { text, truncated } = await readResumePdf(apiKey, bytes);
    return Response.json({ ok: true, text, truncated } satisfies ResumeResponse);
  } catch (e) {
    if (e instanceof BadModelOutputError) return fail(422, e.message);
    // The API's own message can say why (say, a password-protected PDF), but
    // only fixed text is shown.
    if (e instanceof Anthropic.BadRequestError) {
      return fail(422, "Claude couldn't open that PDF. It may be password-protected or damaged; export it again, or paste your resume.");
    }
    return fail(502, `Couldn't read the PDF. ${e instanceof Anthropic.APIError ? describeModelError(e) : "Something went wrong. Try again."}`);
  }
}
