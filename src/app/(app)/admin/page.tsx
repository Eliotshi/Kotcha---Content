import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, fmtRelative } from "@/lib/format";
import { Badge, buttonClass, Card, inputClass, PageHeader, SectionTitle } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { resolveAlert, revokeUserSessions, saveBrandVoice, saveSettings, setUserRole, setUserStatus } from "../actions";

export const metadata: Metadata = { title: "Administration" };

const STATUS = {
  pending: { label: "En attente", tone: "warning" },
  approved: { label: "Validé", tone: "good" },
  rejected: { label: "Refusé", tone: "critical" },
} as const;

const USAGE_LABEL: Record<string, string> = {
  ai_analysis: "Analyses IA",
  ai_script: "Scripts IA",
  transcription: "Transcriptions",
};

const usd = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "USD" });

export default async function AdminPage() {
  const me = await requireAdmin();
  const supabase = await createClient();
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const [{ data: users }, { data: settings }, { data: alerts }, { data: usage }, { data: runs }] = await Promise.all([
    supabase.rpc("admin_list_users"),
    supabase.from("app_settings").select("*").eq("id", 1).maybeSingle(),
    supabase.from("alerts").select("*").order("created_at", { ascending: false }).limit(30),
    supabase.from("usage_events").select("kind, cost_usd").gte("created_at", monthStart),
    supabase.from("scrape_runs").select("cost_usd").gte("started_at", monthStart),
  ]);

  const apifySpent = (runs ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
  const aiByKind = new Map<string, number>();
  for (const u of usage ?? []) if (u.kind in USAGE_LABEL) aiByKind.set(u.kind, (aiByKind.get(u.kind) ?? 0) + Number(u.cost_usd));
  const aiSpent = [...aiByKind.values()].reduce((a, b) => a + b, 0);
  const openAlerts = (alerts ?? []).filter((a) => !a.resolved_at);

  return (
    <>
      <PageHeader title="Administration" subtitle="Comptes, sécurité, budgets et alertes." />

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <div className="text-xs text-text-2">Apify ce mois-ci</div>
          <div className="mt-1 text-2xl font-semibold text-text">
            {usd(apifySpent)} <span className="text-sm font-normal text-text-2">/ {usd(Number(settings?.monthly_budget_apify_usd ?? 0))}</span>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-text-2">IA ce mois-ci (estimation)</div>
          <div className="mt-1 text-2xl font-semibold text-text">
            {usd(aiSpent)} <span className="text-sm font-normal text-text-2">/ {usd(Number(settings?.monthly_budget_ai_usd ?? 0))}</span>
          </div>
          <div className="mt-1 text-xs text-muted">
            {[...aiByKind.entries()].map(([k, v]) => `${USAGE_LABEL[k]} ${usd(v)}`).join(" · ") || "aucune dépense"}
          </div>
        </Card>
      </div>

      <Card className="mb-6 overflow-hidden" id="alertes">
        <div className="p-4 pb-2">
          <SectionTitle>Alertes {openAlerts.length > 0 && <Badge tone="warning">{openAlerts.length} ouvertes</Badge>}</SectionTitle>
        </div>
        <ul className="divide-y divide-border border-t border-border">
          {(alerts ?? []).map((a) => (
            <li key={a.id} className="flex flex-wrap items-start gap-3 px-4 py-3 text-sm">
              <Badge tone={a.resolved_at ? "neutral" : a.level === "critical" ? "critical" : a.level === "warning" ? "warning" : "neutral"}>
                {a.resolved_at ? "Résolue" : a.level === "critical" ? "Critique" : a.level === "warning" ? "Attention" : "Info"}
              </Badge>
              <div className="min-w-0 flex-1">
                <div className={a.resolved_at ? "text-text-2" : "text-text"}>{a.message}</div>
                <div className="text-xs text-muted">{fmtRelative(a.created_at)}</div>
              </div>
              {!a.resolved_at && (
                <form action={resolveAlert.bind(null, a.id)}>
                  <button className={buttonClass.ghost}>Marquer résolue</button>
                </form>
              )}
            </li>
          ))}
          {!alerts?.length && <li className="px-4 py-6 text-center text-sm text-text-2">Aucune alerte.</li>}
        </ul>
      </Card>

      <Card className="mb-6 overflow-hidden">
        <div className="p-4 pb-2">
          <SectionTitle>Comptes</SectionTitle>
          <p className="-mt-1 text-sm text-text-2">
            Une personne n&apos;accède à l&apos;outil qu&apos;après validation. « Révoquer » coupe l&apos;accès aux données immédiatement ;
            « Déconnecter partout » ferme aussi ses sessions sur tous ses appareils (effectif sous 1 h).
          </p>
        </div>
        <ul className="divide-y divide-border border-t border-border">
          {(users ?? []).map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-text">{u.email}</div>
                <div className="text-xs text-text-2">
                  Inscrit le {fmtDate(u.created_at)} · {u.role === "admin" ? "Administrateur" : "Membre"} · dernière connexion{" "}
                  {fmtRelative(u.last_sign_in_at)} · {u.active_sessions} session(s) active(s)
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
                  {u.active_sessions > 0 && (
                    <form action={revokeUserSessions.bind(null, u.id)}>
                      <button className={buttonClass.ghost}>Déconnecter partout</button>
                    </form>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="mb-6 p-4">
        <SectionTitle>Réglages</SectionTitle>
        <form action={saveSettings} className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-xs font-medium text-text-2">Domaines email autorisés à s&apos;inscrire (séparés par des virgules ; vide = tout le monde)</span>
            <input name="allowed_email_domains" defaultValue={(settings?.allowed_email_domains ?? []).join(", ")} placeholder="kotcha.fr" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-text-2">Plafond mensuel Apify (USD)</span>
            <input name="monthly_budget_apify_usd" type="number" min={0} step="1" defaultValue={settings?.monthly_budget_apify_usd} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-text-2">Plafond mensuel IA (USD)</span>
            <input name="monthly_budget_ai_usd" type="number" min={0} step="1" defaultValue={settings?.monthly_budget_ai_usd} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-text-2">Collectes manuelles par 24 h (équipe)</span>
            <input name="daily_limit_manual_collections" type="number" min={0} defaultValue={settings?.daily_limit_manual_collections} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-text-2">Scripts générés par 24 h (par personne)</span>
            <input name="daily_limit_scripts_per_user" type="number" min={0} defaultValue={settings?.daily_limit_scripts_per_user} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-text-2">Ré-analyses par 24 h (par personne)</span>
            <input name="daily_limit_reprocess_per_user" type="number" min={0} defaultValue={settings?.daily_limit_reprocess_per_user} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-text-2">Conservation des posts collectés (mois, RGPD)</span>
            <input name="retention_months" type="number" min={1} max={60} defaultValue={settings?.retention_months} className={inputClass} />
          </label>
          <div className="sm:col-span-2">
            <SubmitButton className={buttonClass.primary} pendingLabel="Enregistrement…">
              Enregistrer les réglages
            </SubmitButton>
          </div>
        </form>
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
