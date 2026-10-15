import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/database.types";

export type Profile = Tables<"profiles">;

/** Profil de l'utilisateur connecté (vérifié auprès du serveur Auth), mis en cache pour la requête. */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  return data;
});

export async function requireApproved(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.status !== "approved") redirect("/pending");
  return profile;
}

export async function requireAdmin(): Promise<Profile> {
  const profile = await requireApproved();
  if (profile.role !== "admin") redirect("/");
  return profile;
}
