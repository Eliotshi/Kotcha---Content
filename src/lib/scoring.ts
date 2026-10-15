import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { scoreAgainst, type Point } from "@/lib/scoring-core";

/**
 * Score de performance à âge égal.
 *
 * Pour un post vu à l'âge A (heures depuis sa publication) avec la valeur V (vues, ou interactions pour LinkedIn) :
 *   référence = médiane, sur les 30 posts les plus récents du compte déjà observés à cet âge, de la valeur qu'ils avaient AU MÊME ÂGE A
 *              (interpolée entre leurs relevés successifs) ;
 *   score     = V / référence.
 * Un post qui fait 6 000 vues en 1 h est donc comparé à ce que les autres posts faisaient en 1 h, pas à leur total final.
 *
 * Exclus de la référence : posts épinglés, partenariats / sponsorisés, collabs (leur portée ne dépend pas que du contenu).
 * Fiabilité : high (≥ 10 posts comparables), medium (≥ 5), low (≥ 3) ; en dessous, pas de score.
 * `estimated` : la référence s'appuie surtout sur une estimation avant le 1er relevé des posts comparés
 *               (croissance supposée concave, en racine du temps) — à lire avec prudence.
 */

const LOOKBACK_DAYS = 180;

function hoursBetween(from: string, to: string) {
  return (new Date(to).getTime() - new Date(from).getTime()) / 3_600_000;
}

export async function recomputeAccountScores(accountId: string): Promise<void> {
  const db = createAdminClient();
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data: posts } = await db
    .from("posts")
    .select("id, platform, published_at, is_pinned, is_paid_partnership, is_collab, views")
    .eq("account_id", accountId)
    .gte("published_at", since)
    .not("published_at", "is", null);
  if (!posts?.length) return;

  const { data: metrics } = await db
    .from("post_metrics")
    .select("post_id, captured_at, views, likes, comments, shares")
    .in("post_id", posts.map((p) => p.id))
    .order("captured_at");

  // Métrique commune au compte : les vues si la plateforme les expose, sinon les interactions.
  const platform = posts[0].platform;
  const useViews = platform !== "linkedin" && posts.some((p) => p.views !== null);
  const valueOf = (m: { views: number | null; likes: number | null; comments: number | null; shares: number | null }) =>
    useViews ? (m.views ?? null) : (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0);

  const series = new Map<string, Point[]>();
  for (const p of posts) series.set(p.id, []);
  for (const m of metrics ?? []) {
    const post = posts.find((p) => p.id === m.post_id)!;
    const value = valueOf(m);
    if (value === null) continue;
    series.get(m.post_id)!.push({ age: Math.max(hoursBetween(post.published_at!, m.captured_at), 0.01), value });
  }

  const comparable = posts
    .filter((p) => !p.is_pinned && !p.is_paid_partnership && !p.is_collab)
    .sort((a, b) => b.published_at!.localeCompare(a.published_at!));

  const now = new Date().toISOString();
  for (const post of posts) {
    const own = series.get(post.id)!;
    const latest = own[own.length - 1];
    if (!latest) continue;

    const others = comparable.filter((o) => o.id !== post.id).map((o) => series.get(o.id)!);
    const { baseline, sample: n, confidence, score, estimated } = scoreAgainst(latest, others);

    await db
      .from("posts")
      .update({
        perf_metric: useViews ? "views" : "interactions",
        perf_value: Math.round(latest.value),
        perf_age_hours: Math.round(latest.age * 10) / 10,
        perf_per_hour: Math.round((latest.value / Math.max(latest.age, 0.5)) * 10) / 10,
        perf_baseline: baseline !== null ? Math.round(baseline) : null,
        perf_score: score,
        perf_sample: n,
        perf_confidence: confidence,
        perf_estimated: estimated,
        score_updated_at: now,
      })
      .eq("id", post.id);
  }
}
