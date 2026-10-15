import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { daysAgoIso, fmtDate, fmtNumber } from "@/lib/format";
import { FORMATS, label, SCRIPT_KINDS } from "@/lib/labels";
import { buttonClass, Card, CompetitorDot, inputClass, OutlierBadge, PageHeader } from "@/components/ui";
import { PlatformTag } from "@/components/platform-icon";
import { SubmitButton } from "@/components/submit-button";
import { createScript } from "../../actions";

export const metadata: Metadata = { title: "Nouveau script" };
// La génération (Claude) prend de 30 s à 2 min.
export const maxDuration = 300;

export default async function NewScriptPage({ searchParams }: PageProps<"/scripts/new">) {
  const sp = await searchParams;
  const preselected = new Set(String(sp.posts ?? "").split(",").filter(Boolean));

  const supabase = await createClient();
  const { data: candidates } = await supabase
    .from("post_feed")
    .select("id, competitor_name, competitor_color, platform, published_at, hook, caption, format, outlier_score, views")
    .eq("processing_status", "done")
    .gte("published_at", daysAgoIso(90))
    .order("outlier_score", { ascending: false, nullsFirst: false })
    .limit(30);

  // Les posts présélectionnés apparaissent en premier, même hors du top 30.
  const missing = [...preselected].filter((id) => !(candidates ?? []).some((c) => c.id === id));
  const { data: extra } = missing.length
    ? await supabase
        .from("post_feed")
        .select("id, competitor_name, competitor_color, platform, published_at, hook, caption, format, outlier_score, views")
        .in("id", missing)
    : { data: [] };
  const posts = [...(extra ?? []), ...(candidates ?? [])].sort(
    (a, b) => Number(preselected.has(b.id!)) - Number(preselected.has(a.id!)),
  );

  return (
    <>
      <div className="mb-4">
        <Link href="/scripts" className="text-sm text-text-2 hover:text-text">
          ← Scripts
        </Link>
      </div>
      <PageHeader title="Nouveau script" subtitle="Choisis un format, un brief et les posts concurrents dont s'inspirer (5 max)." />

      <form action={createScript} className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Card className="flex h-fit flex-col gap-4 p-4 lg:sticky lg:top-8">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-xs font-medium text-text-2">Format</legend>
            {Object.entries(SCRIPT_KINDS).map(([k, v], i) => (
              <label key={k} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                <input type="radio" name="kind" value={k} defaultChecked={i === 0} className="accent-[var(--accent)]" />
                {v}
              </label>
            ))}
          </fieldset>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-text-2">Brief (optionnel)</span>
            <textarea
              name="brief"
              rows={5}
              className={inputClass}
              placeholder="Ex. : vidéo pour la reprise de septembre, cible débutants, mettre en avant le plan adaptatif…"
            />
          </label>
          <SubmitButton className={buttonClass.primary} pendingLabel="Génération en cours (≈1 min)…">
            Générer le script
          </SubmitButton>
        </Card>

        <div className="flex flex-col gap-2">
          <div className="px-1 text-xs text-text-2">Posts analysés des 90 derniers jours, triés par surperformance</div>
          {posts.length === 0 && (
            <Card className="p-4 text-sm text-text-2">Aucun post analysé pour l&apos;instant : le script partira uniquement du brief.</Card>
          )}
          {posts.map((p) => (
            <label key={p.id} className="block cursor-pointer">
              <Card className="flex items-start gap-3 p-3 has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                <input
                  type="checkbox"
                  name="post_ids"
                  value={p.id!}
                  defaultChecked={preselected.has(p.id!)}
                  className="mt-1 accent-[var(--accent)]"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-text-2">
                    <span className="inline-flex items-center gap-1.5 font-medium text-text">
                      <CompetitorDot color={p.competitor_color} />
                      {p.competitor_name}
                    </span>
                    <PlatformTag platform={p.platform} />
                    <span>{fmtDate(p.published_at)}</span>
                    {p.views !== null && <span>{fmtNumber(p.views)} vues</span>}
                    <OutlierBadge score={p.outlier_score} />
                    {p.format && <span>· {label(FORMATS, p.format)}</span>}
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-text">{p.hook ? `« ${p.hook} »` : p.caption}</p>
                </div>
              </Card>
            </label>
          ))}
        </div>
      </form>
    </>
  );
}
