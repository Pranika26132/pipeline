"use client";

import { useActionState, useState } from "react";

import {
  INTERESTS,
  LEVELS,
  LIMITS,
  readProfileForm,
  ROLE_PRESETS,
  WEIGHTS,
  type ProfileValues,
  type WeightKey,
} from "@/lib/profile";

import { saveProfile, type ProfileState } from "./actions";

// A dropped connection or an oversized request throws instead of returning
// an error. Catch it here so the message shows in the form and nothing typed
// is lost.
async function save(prev: ProfileState, formData: FormData): Promise<ProfileState> {
  try {
    return await saveProfile(prev, formData);
  } catch {
    return {
      submittedAt: Date.now(),
      values: readProfileForm(formData),
      error: "Couldn't reach the server, so nothing was saved. Check your connection and try again.",
    };
  }
}

const field =
  "min-h-12 w-full rounded-md border border-rule bg-field px-4 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";
const choice =
  "flex min-h-12 cursor-pointer items-center gap-3 rounded-md border border-rule bg-field px-4 text-base has-[:checked]:border-accent has-[:checked]:font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/30";
const box = "size-5 shrink-0 accent-[var(--accent)]";
const sectionClass = "mt-10 flex flex-col gap-5 border-t-2 border-foreground pt-6";

export function ProfileForm({ initial }: { initial: ProfileValues }) {
  const [state, formAction, pending] = useActionState<ProfileState, FormData>(save, {});
  const values = state.values ?? initial;
  // Remount on each result so the fields show what was just submitted.
  const formKey = state.submittedAt ?? 0;

  return (
    <form key={formKey} action={formAction} noValidate className="flex flex-col">
      <section aria-labelledby="about-you" className="mt-8 flex flex-col gap-5">
        <h2 id="about-you" className="text-xl font-semibold">
          About you
        </h2>
        <label className="flex flex-col gap-2">
          <span className="text-base font-medium">School</span>
          <input name="school" defaultValue={values.school} maxLength={LIMITS.text} autoComplete="organization" className={field} />
          <span className="text-sm text-muted">Use the name founders would list, like Duke University.</span>
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-base font-medium">Hometown or region</span>
          <input name="hometown" defaultValue={values.hometown} maxLength={LIMITS.text} autoComplete="address-level2" className={field} />
          <span className="text-sm text-muted">A city, state or region, like Raleigh, North Carolina.</span>
        </label>
      </section>

      <section aria-labelledby="looking-for" className={sectionClass}>
        <h2 id="looking-for" className="text-xl font-semibold">
          What you’re looking for
        </h2>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-base font-medium">Interests</legend>
          <div className="grid grid-cols-2 gap-2">
            {INTERESTS.map((i) => (
              <label key={i.value} className={choice}>
                <input type="checkbox" name="interests" value={i.value} defaultChecked={values.interests.includes(i.value)} className={box} />
                {i.label}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-base font-medium">Internship roles</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {ROLE_PRESETS.map((r) => (
              <label key={r} className={choice}>
                <input type="checkbox" name="roles" value={r} defaultChecked={values.roles.includes(r)} className={box} />
                {r}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex flex-col gap-2">
          <span className="text-base font-medium">
            Other roles <span className="font-normal text-muted">(separate with commas)</span>
          </span>
          <input
            name="otherRoles"
            defaultValue={values.otherRoles}
            maxLength={LIMITS.otherRoles}
            autoComplete="off"
            className={field}
          />
        </label>
      </section>

      <section aria-labelledby="writing" className={sectionClass}>
        <div className="flex flex-col gap-2">
          <h2 id="writing" className="text-xl font-semibold">
            Your writing
          </h2>
          <p className="text-base text-muted">
            Paste a couple of emails or messages you’ve written. Drafts will copy your tone so they sound like you, not AI.
          </p>
        </div>
        {values.samples.map((s, i) => (
          <label key={i} className="flex flex-col gap-2">
            <span className="text-base font-medium">
              Sample {i + 1} <span className="font-normal text-muted">(optional)</span>
            </span>
            <textarea
              name={`sample${i}`}
              defaultValue={s}
              rows={5}
              maxLength={LIMITS.sample}
              className={`${field} py-3 leading-relaxed`}
            />
          </label>
        ))}
      </section>

      <Weights initial={values.weights} />

      <div className="sticky bottom-0 -mx-4 mt-10 flex flex-col gap-3 border-t border-rule bg-background px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div aria-live="polite" className="empty:hidden">
          {state.error && !pending && (
            <p role="alert" className="rounded-md bg-danger-surface px-4 py-3 text-base text-danger">
              {state.error}
            </p>
          )}
          {state.saved && !pending && <p className="rounded-md border border-accent px-4 py-3 text-base">Profile saved.</p>}
        </div>
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="min-h-14 rounded-lg bg-accent px-6 text-lg font-semibold text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save profile"}
        </button>
      </div>
    </form>
  );
}

function Weights({ initial }: { initial: Record<WeightKey, string> }) {
  const [weights, setWeights] = useState(initial);
  const defaults = Object.fromEntries(WEIGHTS.map((w) => [w.key, w.fallback])) as Record<WeightKey, string>;
  const isDefault = WEIGHTS.every((w) => weights[w.key] === defaults[w.key]);

  // Closed by default. Its choices are submitted with the form either way.
  return (
    <details className="group mt-10 border-t-2 border-foreground pt-2">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        <span className="flex flex-col">
          <span className="text-xl font-semibold">Customize ranking</span>
          <span className="text-sm text-muted">{isDefault ? "Using the standard ranking" : "You’ve changed the ranking"}</span>
        </span>
        <span aria-hidden className="text-2xl leading-none transition-transform group-open:rotate-45 motion-reduce:transition-none">
          +
        </span>
      </summary>
      <div className="flex flex-col gap-6 pt-4 pb-2">
        <p className="text-base text-muted">
          Choose what moves a company up your list. Each is checked only against what the company’s own pages say.
        </p>
        {WEIGHTS.map((w) => (
          <fieldset key={w.key} className="flex flex-col gap-2">
            <legend className="mb-2 text-base font-medium">{w.label}</legend>
            <div className="grid grid-cols-3 gap-2">
              {LEVELS.map((l) => (
                <label
                  key={l.value}
                  className="flex min-h-12 cursor-pointer items-center justify-center rounded-md border border-rule bg-field px-2 py-2 text-center text-sm leading-tight has-[:checked]:border-accent has-[:checked]:bg-accent has-[:checked]:font-semibold has-[:checked]:text-accent-foreground has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent sm:text-base"
                >
                  <input
                    type="radio"
                    name={w.key}
                    value={l.value}
                    checked={weights[w.key] === l.value}
                    onChange={() => setWeights({ ...weights, [w.key]: l.value })}
                    className="sr-only"
                  />
                  {l.label}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <button
          type="button"
          onClick={() => setWeights(defaults)}
          disabled={isDefault}
          className="-ml-2 flex min-h-12 w-fit items-center px-2 text-base font-medium underline underline-offset-4 disabled:no-underline disabled:opacity-50"
        >
          Use the standard ranking
        </button>
      </div>
    </details>
  );
}
