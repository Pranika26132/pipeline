"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type SignOutState = { error?: string };

export async function signOut(): Promise<SignOutState> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    return { error: `Couldn't sign out (${error.message}). Try again.` };
  }
  revalidatePath("/", "layout");
  redirect("/login");
}
