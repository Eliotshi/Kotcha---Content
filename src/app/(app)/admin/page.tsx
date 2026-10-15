import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDate } from "@/lib/format";
import { Badge, buttonClass, Card, inputClass, PageHeader, SectionTitle } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { saveBrandVoice, setUserRole, setUserStatus } from "../actions";

export const metadata: Metadata = { title: "Administration" };

const STATUS = {
  pending: { label: "En attente", tone: "warning" },
  approved: { label: "Validé", tone: "good" },
  rejected: { label: "Refusé", tone: "critical" },
} as const;

export default async function AdminPage() {
  const me = await requireAdmin();
  const supabase = await createClient();
  const [{ data: users }, { data: settings }] = await Promise.all([
    supabase.from("profiles").select("*").order("created_at", { ascending: false }),
    supabase.from("app_settings").select("*").eq("id", 1).maybeSingle(),
  ]);
  const sorted = [...(users ?? [])].sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending"));

  return (
    <>
      <PageHeader title="Administration" subtitle="Validation des comptes et réglages de génération." />

      <Card className="mb-6 overflow-hidden">
        <div className="p-4 pb-2">
          <SectionTitle>Comptes</SectionTitle>
          <p className="-mt-1 text-sm text-text-2">
            Toute personne peut demander un accès en se connectant avec son email ; elle n&apos;accède à l&apos;outil qu&apos;après validation ici.
          </p>
        </div>
        <ul className="divide-y divide-border border-t border-border">
          {sorted.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-text">{u.email}</div>
                <div className="text-xs text-text-2">
                  Inscrit le {fmtDate(u.created_at)} · {u.role === "admin" ? "Administrateur" : "Membre"}
                </div>
              </div>
              <Badge tone={STATUS[u.status].tone}>{STATUS[u.status].label}</Badge>
              {u.id !== me.id && (
                <div className="flex flex-wrap gap-1">
                  {u.status !== "approved" && (
                    <form action={setUserStatus.bind(null, u.id, "approved")}>
                      <button className={buttonClass.primary}>Valider</button>
                    </form>
                  )}
                  {u.status !== "rejected" && (
                    <form action={setUserStatus.bind(null, u.id, "rejected")}>
                      <button className={buttonClass.danger}>{u.status === "approved" ? "Révoquer" : "Refuser"}</button>
                    </form>
                  )}
                  {u.status === "approved" && (
                    <form action={setUserRole.bind(null, u.id, u.role === "admin" ? "member" : "admin")}>
                      <button className={buttonClass.ghost}>{u.role === "admin" ? "Retirer admin" : "Passer admin"}</button>
                    </form>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-4">
        <SectionTitle>Voix de marque Kotcha</SectionTitle>
        <p className="mb-3 text-sm text-text-2">
          Utilisée à chaque génération de script : ton, tutoiement ou vouvoiement, promesse, cibles, mots à éviter, exemples de phrases.
        </p>
        <form action={saveBrandVoice} className="flex flex-col gap-3">
          <textarea name="brand_voice" rows={10} defaultValue={settings?.brand_voice ?? ""} className={inputClass} />
          <SubmitButton className={`${buttonClass.primary} self-start`} pendingLabel="Enregistrement…">
            Enregistrer
          </SubmitButton>
        </form>
      </Card>
    </>
  );
}
