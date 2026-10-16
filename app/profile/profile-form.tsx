"use client";

import { useActionState, useState } from "react";

import { INTERESTS, LIMITS, ROLE_PRESETS, WEIGHTS, type WeightKey } from "@/lib/profile";

import { saveProfile, type ProfileState, type ProfileValues } from "./actions";

const field =
  "min-h-12 w-full rounded-md border border-rule bg-field px-4 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";
const choice =
  "flex min-h-12 cursor-pointer items-center gap-3 rounded-md border border-rule bg-field px-4 text-base has-[:checked]:border-accent has-[:checked]:font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/30";
const box = "size-5 shrink-0 accent-[var(--accent)]";
const sectionClass = "mt-10 flex flex-col gap-5 border-t-2 border-foreground pt-6";

export function ProfileForm({ initial }: { initial: ProfileValues }) {
  const [state, formAction, pending] = useActionState<ProfileState, FormData>(saveProfile, {});
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
          <input name="otherRoles" defaultValue={values.otherRoles} autoComplete="off" className={field} />
        </label>
      </section>

      <section aria-labelledby="writing" className={sectionClass}>
        <div className="flex flex-col gap-2">
          <h2 id="writing" className="text-xl font-semibold">
            Your writing
          </h2>
          <p className="text-base text-muted">
            Paste two or three things you wrote yourself, such as an email or a cover letter paragraph. Drafts follow their
            tone. Up to {LIMITS.sample.toLocaleString()} characters each.
          </p>
        </div>
        {values.samples.map((s, i) => (
          <label key={i} className="flex flex-col gap-2">
            <span className="text-base font-medium">
              Sample {i + 1}
              {i === LIMITS.samples - 1 && <span className="font-normal text-muted"> (optional)</span>}
            </span>
            <textarea name={`sample${i}`} defaultValue={s} rows={5} className={`${field} py-3 leading-relaxed`} />
          </label>
        ))}
      </section>

      <Weights initial={values.weights} />

      <div className="sticky bottom-0 -mx-4 mt-10 flex flex-col gap-3 border-t border-rule bg-background px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div aria-live="polite" className="empty:hidden">
          {state.error && (
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
  const defaults = Object.fromEntries(WEIGHTS.map((w) => [w.key, String(w.fallback)])) as Record<WeightKey, string>;
  const isDefault = WEIGHTS.every((w) => weights[w.key] === defaults[w.key]);

  return (
    <section aria-labelledby="scoring" className={sectionClass}>
      <div className="flex flex-col gap-2">
        <h2 id="scoring" className="text-xl font-semibold">
          How companies are scored
        </h2>
        <p className="text-base text-muted">
          A company’s score is the sum of the points below for each thing found on its own pages. Use 0 to ignore one.
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-rule border-y border-rule">
        {WEIGHTS.map((w) => (
          <li key={w.key}>
            <label className="flex min-h-16 items-center justify-between gap-4 py-3">
              <span className="text-base">
                {w.label}
                <span className="block text-sm text-muted">Default {w.fallback}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <input
                  name={w.key}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={LIMITS.weightMax}
                  step={1}
                  value={weights[w.key]}
                  onChange={(e) => setWeights({ ...weights, [w.key]: e.target.value })}
                  className={`${field} w-20 text-center text-lg font-semibold tabular-nums`}
                />
                <span className="text-sm text-muted" aria-hidden>
                  pts
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => setWeights(defaults)}
        disabled={isDefault}
        className="-ml-2 flex min-h-12 w-fit items-center px-2 text-base font-medium underline underline-offset-4 disabled:no-underline disabled:opacity-50"
      >
        Use the defaults
      </button>
    </section>
  );
}
