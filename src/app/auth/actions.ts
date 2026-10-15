"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/** Déconnecte tous les appareils de l'utilisateur courant (révocation de toutes ses sessions). */
export async function signOutEverywhere() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "global" });
  redirect("/login");
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Envoie le code de connexion. Le domaine est vérifié ici pour afficher un message clair ;
 * la base le revérifie à la création du compte (impossible à contourner via l'API Auth).
 */
export async function requestCode(rawEmail: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) return { ok: false, error: "Adresse email invalide." };

  const admin = createAdminClient();
  const [{ data: settings }, { data: bootstrap }] = await Promise.all([
    admin.from("app_settings").select("allowed_email_domains").eq("id", 1).single(),
    admin.from("admin_bootstrap").select("email").eq("email", email).maybeSingle(),
  ]);
  const domains = (settings?.allowed_email_domains ?? []).map((d) => d.toLowerCase());
  const domain = email.split("@")[1];
  if (domains.length && !domains.includes(domain) && !bootstrap) {
    return { ok: false, error: "Cette adresse n'est pas autorisée. Utilise ton email professionnel." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) {
    if (error.status === 429) return { ok: false, error: "Trop de demandes. Patiente une minute avant de redemander un code." };
    return { ok: false, error: "Impossible d'envoyer le code pour le moment." };
  }
  return { ok: true };
}
