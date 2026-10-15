import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { fmtDate, fmtNumber, fmtRelative } from "@/lib/format";
import { PLATFORM_LABEL, PLATFORMS, profileUrl } from "@/lib/platforms";
import { PlatformTag } from "@/components/platform-icon";
import { Badge, buttonClass, Card, CompetitorDot, inputClass, PageHeader, SectionTitle } from "@/components/ui";
import { ActionButton } from "@/components/action-button";
import { addAccount, addCompetitor, deleteAccount, deleteCompetitor, runCollectionNow, setAccountActive } from "../actions";

export const metadata: Metadata = { title: "Concurrents" };

const RUN_TONE: Record<string, "good" | "warning" | "critical" | "neutral"> = {
  SUCCEEDED: "good",
  RUNNING: "warning",
  READY: "warning",
  FAILED: "critical",
  "TIMED-OUT": "critical",
  ABORTED: "critical",
};

export default async function CompetitorsPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const isAdmin = profile?.role === "admin";

  const [{ data: competitors }, { data: accounts }, { data: runs }, { data: monthRuns }, { data: settings }] = await Promise.all([
    supabase.from("competitors").select("*").order("name"),
    supabase.from("social_accounts").select("*").order("platform"),
    supabase.from("scrape_runs").select("*").order("started_at", { ascending: false }).limit(15),
    supabase
      .from("scrape_runs")
      .select("cost_usd")
      .gte("started_at", new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString()),
    supabase.from("app_settings").select("monthly_budget_apify_usd").eq("id", 1).maybeSingle(),
  ]);
  const monthCost = (monthRuns ?? []).reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0);
  const accountLabel = new Map((accounts ?? []).map((a) => [a.id, `${PLATFORM_LABEL[a.platform]} · ${a.platform === "linkedin" ? a.handle.replace(/^https?:\/\/(www\.)?linkedin\.com\//, "") : "@" + a.handle}`]));

  return (
    <>
      <PageHeader
        title="Concurrents"
        subtitle={
          <>
            Comptes suivis, collectés automatiquement tous les 2 jours via Apify. Coût Apify ce mois-ci :{" "}
            <span className="font-medium text-text tabular">{monthCost.toLocaleString("fr-FR", { style: "currency", currency: "USD" })}</span>
          </>
        }
        actions={
          <ActionButton action={runCollectionNow.bind(null, undefined)} className={buttonClass.primary} pendingLabel="Lancement…">
            Lancer une collecte maintenant
          </ActionButton>
        }
      />

      <p className="-mt-3 mb-5 text-xs text-text-2">
        Plafond Apify : {monthCost.toLocaleString("fr-FR", { style: "currency", currency: "USD" })} /{" "}
        {Number(settings?.monthly_budget_apify_usd ?? 0).toLocaleString("fr-FR", { style: "currency", currency: "USD" })} ce mois-ci. Au-delà,
        les collectes sont suspendues automatiquement.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        {(competitors ?? []).map((c) => {
          const own = (accounts ?? []).filter((a) => a.competitor_id === c.id);
          return (
            <Card key={c.id} className="p-4">
              <SectionTitle
                action={
                  isAdmin ? (
                    <form action={deleteCompetitor.bind(null, c.id)}>
                      <button className={buttonClass.danger}>Supprimer</button>
                    </form>
                  ) : undefined
                }
              >
                <span className="inline-flex items-center gap-2">
                  <CompetitorDot color={c.color} />
                  {c.name}
                  {c.website && (
                    <a href={c.website} target="_blank" rel="noopener noreferrer" className="text-xs font-normal text-text-2 hover:text-text">
                      site ↗
                    </a>
                  )}
                </span>
              </SectionTitle>

              <ul className="flex flex-col divide-y divide-border">
                {own.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                    <PlatformTag platform={a.platform} />
                    <a href={profileUrl(a.platform, a.handle)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-text hover:underline">
                      {a.platform === "linkedin" ? a.handle.replace(/^https?:\/\/(www\.)?linkedin\.com\//, "") : `@${a.handle}`}
                    </a>
                    <span className="text-xs text-text-2 tabular">{a.followers ? `${fmtNumber(a.followers)} abonnés` : ""}</span>
                    <span className="text-xs text-muted">{fmtRelative(a.last_scraped_at)}</span>
                    <div className="flex items-center gap-1">
                      <form action={setAccountActive.bind(null, a.id, !a.active)}>
                        <button className={buttonClass.ghost}>{a.active ? "Pause" : "Réactiver"}</button>
                      </form>
                      <ActionButton action={runCollectionNow.bind(null, a.id)} className={buttonClass.ghost} pendingLabel="…" disabled={!a.active}>
                        Collecter
                      </ActionButton>
                      {isAdmin && (
                        <form action={deleteAccount.bind(null, a.id)}>
                          <button className={buttonClass.danger} aria-label="Supprimer le compte">
                            ✕
                          </button>
                        </form>
                      )}
                    </div>
                    {!a.active && <Badge>En pause</Badge>}
                  </li>
                ))}
                {!own.length && <li className="py-3 text-sm text-text-2">Aucun compte suivi.</li>}
              </ul>

              <form action={addAccount} className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                <input type="hidden" name="competitor_id" value={c.id} />
                <select name="platform" className={`${inputClass} w-auto`} defaultValue="instagram">
                  {PLATFORMS.map((p) => (
                    <option key={p} value={p}>
                      {PLATFORM_LABEL[p]}
                    </option>
                  ))}
                </select>
                <input name="handle" required placeholder="@compte ou URL de la page" className={`${inputClass} min-w-40 flex-1`} />
                <button className={buttonClass.secondary}>Ajouter</button>
              </form>
            </Card>
          );
        })}

        <Card className="p-4">
          <SectionTitle>Ajouter un concurrent</SectionTitle>
          <form action={addCompetitor} className="flex flex-col gap-2">
            <input name="name" required placeholder="Nom" className={inputClass} />
            <input name="website" placeholder="Site web (optionnel)" className={inputClass} />
            <button className={`${buttonClass.secondary} self-start`}>Ajouter</button>
          </form>
        </Card>
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="p-4 pb-2">
          <SectionTitle>Dernières collectes</SectionTitle>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-y border-border bg-surface-2 text-xs text-text-2">
              <tr>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Compte</th>
                <th className="px-4 py-2 font-medium">Statut</th>
                <th className="px-4 py-2 font-medium">Qualité</th>
                <th className="px-4 py-2 text-right font-medium">Posts</th>
                <th className="px-4 py-2 text-right font-medium">Nouveaux</th>
                <th className="px-4 py-2 text-right font-medium">Coût</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {(runs ?? []).map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 text-text-2">{fmtDate(r.started_at, true)}</td>
                  <td className="px-4 py-2 text-text">
                    {r.purpose === "media"
                      ? `Médias ${PLATFORM_LABEL[r.platform]} (${r.post_ids.length} post${r.post_ids.length > 1 ? "s" : ""})`
                      : r.account_ids.map((id) => accountLabel.get(id) ?? "compte supprimé").join(", ")}
                  </td>
                  <td className="px-4 py-2">
                    <Badge tone={RUN_TONE[r.status] ?? "neutral"}>{r.status}</Badge>
                    {r.error && <div className="mt-1 max-w-xs truncate text-xs text-critical" title={r.error}>{r.error}</div>}
                  </td>
                  <td className="px-4 py-2">
                    {r.health ? (
                      <Badge tone={r.health === "ok" ? "good" : r.health === "warning" ? "warning" : "critical"}>
                        {r.health === "ok" ? "OK" : r.health === "warning" ? "À vérifier" : "Problème"}
                      </Badge>
                    ) : (
                      "—"
                    )}
                    {Array.isArray((r.quality as { issues?: string[] } | null)?.issues) &&
                      ((r.quality as { issues: string[] }).issues.length > 0) && (
                        <div className="mt-1 max-w-xs text-xs text-text-2">{(r.quality as { issues: string[] }).issues.join(" ; ")}</div>
                      )}
                  </td>
                  <td className="px-4 py-2 text-right">{r.items_count ?? "—"}</td>
                  <td className="px-4 py-2 text-right">{r.new_posts ?? "—"}</td>
                  <td className="px-4 py-2 text-right">{r.cost_usd !== null ? `${Number(r.cost_usd).toFixed(3)} $` : "—"}</td>
                </tr>
              ))}
              {!runs?.length && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-text-2">
                    Aucune collecte pour l&apos;instant.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
