import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { levelFor, LIMITS, ROLE_PRESETS, WEIGHTS, type ProfileValues, type WeightKey } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";

import { EmailAddress } from "../email-address";
import { SignOutButton } from "../sign-out-button";
import { TopBar } from "../top-bar";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = {
  title: "Your profile · Pipeline",
};

export default function ProfilePage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 pt-6 sm:pt-12">
      <TopBar onProfile />
      <h1 className="mt-6 text-4xl font-bold tracking-[-0.04em]">Your profile</h1>
      <p className="mt-3 text-lg text-muted">
        Pipeline ranks companies by these details and writes drafts from your samples. Only you can see them.
      </p>
      <Suspense fallback={<p className="mt-6 text-lg text-muted">Loading your profile…</p>}>
        <Profile />
      </Suspense>
    </main>
  );
}

async function Profile() {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError) {
    return <Alert>Your session couldn’t be checked ({authError.message}). Sign in again.</Alert>;
  }
  if (!auth?.claims) redirect("/login");

  // RLS returns only the signed-in user's row; none until the first save.
  const { data, error } = await supabase
    .from("profiles")
    .select("full_name, school, hometown, grad_year, degree, major, resume, interests, role_targets, writing_samples, weight_school, weight_hometown, weight_open_role, weight_early_stage, weight_region")
    .maybeSingle();
  if (error) return <Alert>Couldn’t load your profile ({error.message}). Reload to try again.</Alert>;

  const presets = new Set<string>(ROLE_PRESETS);
  const roles = data?.role_targets ?? [];
  const samples = data?.writing_samples ?? [];
  const initial: ProfileValues = {
    fullName: data?.full_name ?? "",
    school: data?.school ?? "",
    hometown: data?.hometown ?? "",
    gradYear: data?.grad_year ? String(data.grad_year) : "",
    degree: data?.degree ?? "",
    major: data?.major ?? "",
    resume: data?.resume ?? "",
    interests: data?.interests ?? [],
    roles: roles.filter((r: string) => presets.has(r)),
    otherRoles: roles.filter((r: string) => !presets.has(r)).join(", "),
    samples: Array.from({ length: LIMITS.samples }, (_, i) => samples[i] ?? ""),
    weights: Object.fromEntries(
      WEIGHTS.map((w) => [w.key, levelFor(w.key, data?.[w.key])]),
    ) as Record<WeightKey, string>,
  };

  return (
    <>
      <ProfileForm initial={initial} />
      <section aria-label="Account" className="mt-12 flex flex-col gap-4 border-t-2 border-foreground pt-6 pb-10">
        <p className="text-base text-muted">
          Signed in as <EmailAddress address={auth.claims.email ?? ""} />
        </p>
        <SignOutButton />
      </section>
    </>
  );
}

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="mt-6 rounded-md bg-danger-surface px-4 py-3 text-base text-danger">
      {children}
    </p>
  );
}
