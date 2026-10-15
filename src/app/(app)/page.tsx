import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { daysAgoIso, fmtNumber, fmtRelative, fmtScore } from "@/lib/format";
import { FORMATS, label } from "@/lib/labels";
import { PLATFORM_LABEL, PLATFORMS } from "@/lib/platforms";
import { PostCard } from "@/components/post-card";
import { AlertsBanner } from "@/components/alerts-banner";
import { buttonClass, Card, cx, EmptyState, inputClass, PageHeader, StatTile } from "@/components/ui";
import { processQueueNow } from "./actions";

export const metadata: Metadata = { title: "Veille" };

const PERIODS = { "7": "7 jours", "30": "30 jours", "90": "90 jours", all: "Tout" } as const;
const SORTS = { recent: "Plus récents", outlier: "Score à âge égal", velocity: "Rythme (vues/h)", engagement: "Engagement" } as const;
const CATEGORIES = {
  posts: "Posts",
  pinned: "Épinglés",
  partnerships: "Partenariats & collabs",
} as const;

// Seuils minimaux avant d'afficher une conclusion (en dessous, c'est du bruit).
const MIN_POSTS_PER_FORMAT = 5;
const MIN_SCORED_POSTS = 15;

function median(values: number[]) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export default async function FeedPage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) ?? "";
  const platform = one("platform");
  const competitor = one("competitor");
  const format = one("format");
  const category = (one("category") || "posts") as keyof typeof CATEGORIES;
  const period = (one("period") || "30") as keyof typeof PERIODS;
  const sort = (one("sort") || "recent") as keyof typeof SORTS;

  const supabase = await createClient();
  let query = supabase.from("post_feed").select("*").limit(500);
  if (platform && PLATFORMS.includes(platform as never)) query = query.eq("platform", platform as never);
  if (competitor) query = query.eq("competitor_id", competitor);
  if (format) query = query.eq("format", format);
  if (category === "pinned") query = query.eq("is_pinned", true);
  else if (category === "partnerships") query = query.eq("is_pinned", false).or("is_paid_partnership.eq.true,is_collab.eq.true");
  else query = query.eq("is_pinned", false).eq("is_paid_partnership", false).eq("is_collab", false);
  if (period !== "all" && PERIODS[period] && category !== "pinned") {
    query = query.gte("published_at", daysAgoIso(Number(period)));
  }
  query =
    sort === "outlier"
      ? query.order("outlier_score", { ascending: false, nullsFirst: false })
      : sort === "velocity"
        ? query.order("perf_per_hour", { ascending: false, nullsFirst: false })
        : sort === "engagement"
          ? query.order("engagement_rate", { ascending: false, nullsFirst: false })
          : query.order("published_at", { ascending: false, nullsFirst: false });

  const [{ data: posts }, { data: competitors }, { data: lastRun }, { count: queued }, { data: alerts }] = await Promise.all([
    query,
    supabase.from("competitors").select("id, name").order("name"),
    supabase.from("scrape_runs").select("finished_at, started_at").eq("status", "SUCCEEDED").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("posts").select("id", { count: "exact", head: true }).in("processing_status", ["pending", "processing"]),
    supabase.from("alerts").select("id, level, message, created_at").is("resolved_at", null).order("created_at", { ascending: false }).limit(5),
  ]);

  const list = posts ?? [];
  const truncated = list.length === 500;
  const scored = list.filter((p) => p.outlier_score !== null);
  const outliers = scored.filter((p) => p.outlier_score! >= 2);

  // Vues médianes par plateforme : Instagram (lectures) et TikTok (vues) ne se mesurent pas pareil.
  const viewsByPlatform = (["instagram", "tiktok"] as const).map((pl) => {
    const v = list.filter((p) => p.platform === pl && p.views !== null && p.media_type === "video").map((p) => p.views!);
    return { pl, median: median(v), n: v.length };
  });

  // Format qui surperforme : médiane des scores (robuste aux valeurs extrêmes), avec des seuils minimaux.
  const byFormat = new Map<string, number[]>();
  for (const p of scored) if (p.format) byFormat.set(p.format, [...(byFormat.get(p.format) ?? []), p.outlier_score!]);
  const best = [...byFormat.entries()]
    .filter(([, scores]) => scores.length >= MIN_POSTS_PER_FORMAT)
    .map(([f, scores]) => ({ f, med: median(scores)!, n: scores.length }))
    .sort((a, b) => b.med - a.med)[0];
  const enoughForFormat = scored.length >= MIN_SCORED_POSTS && best;

  const linkFor = (c: string) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ platform, competitor, format, period, sort, category: c })) if (v) params.set(k, v);
    return `/?${params.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Veille concurrents"
        subtitle={<>Dernière collecte réussie : {fmtRelative(lastRun?.finished_at ?? lastRun?.started_at)}</>}
        actions={
          <>
            {(queued ?? 0) > 0 && (
              <form action={processQueueNow}>
                <button className={buttonClass.secondary}>Analyser la file ({queued})</button>
              </form>
            )}
            <Link href="/scripts/new" className={buttonClass.primary}>
              Nouveau script
            </Link>
          </>
        }
      />

      <AlertsBanner alerts={alerts ?? []} />

      <nav className="mb-4 flex gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1" aria-label="Catégories">
        {Object.entries(CATEGORIES).map(([k, v]) => (
          <Link
            key={k}
            href={linkFor(k)}
            className={cx("whitespace-nowrap rounded-md px-3 py-1.5 text-sm", category === k ? "bg-accent text-accent-ink" : "text-text-2 hover:bg-surface-2")}
          >
            {v}
          </Link>
        ))}
      </nav>
      {category !== "posts" && (
        <p className="mb-4 text-sm text-text-2">
          {category === "pinned"
            ? "Posts mis en avant en haut du profil, souvent anciens : affichés à part et exclus des moyennes de référence."
            : "Partenariats, contenus sponsorisés et collabs : leur portée dépend aussi de l'audience du partenaire ou d'un budget publicitaire. Exclus des moyennes de référence."}
        </p>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Posts sur la période" value={fmtNumber(list.length)} hint={`${scored.length} avec un score${truncated ? " · liste tronquée à 500" : ""}`} />
        <StatTile
          label="Posts à plus de 2× à âge égal"
          value={fmtNumber(outliers.length)}
          hint={scored.length ? `sur ${scored.length} posts notés` : "pas encore d'historique"}
        />
        <Card className="p-4">
          <div className="text-xs text-text-2">Vues médianes des vidéos</div>
          <dl className="mt-1 flex flex-col gap-0.5">
            {viewsByPlatform.map(({ pl, median: m, n }) => (
              <div key={pl} className="flex items-baseline justify-between gap-2">
                <dt className="text-xs text-text-2">{PLATFORM_LABEL[pl]}</dt>
                <dd className="text-lg font-semibold text-text tabular">
                  {fmtNumber(m)} <span className="text-xs font-normal text-muted">n={n}</span>
                </dd>
              </div>
            ))}
          </dl>
        </Card>
        <StatTile
          label="Format qui surperforme"
          value={<span className="text-lg">{enoughForFormat ? label(FORMATS, best.f) : "—"}</span>}
          hint={
            enoughForFormat
              ? `score médian ${fmtScore(best.med)} sur ${best.n} posts`
              : `pas assez de données (${scored.length}/${MIN_SCORED_POSTS} posts notés, ${MIN_POSTS_PER_FORMAT} min. par format)`
          }
        />
      </div>

      <form className="mb-5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center" method="get">
        <input type="hidden" name="category" value={category} />
        <select name="competitor" defaultValue={competitor} className={`${inputClass} sm:w-auto`}>
          <option value="">Tous les concurrents</option>
          {(competitors ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select name="platform" defaultValue={platform} className={`${inputClass} sm:w-auto`}>
          <option value="">Toutes les plateformes</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {PLATFORM_LABEL[p]}
            </option>
          ))}
        </select>
        <select name="period" defaultValue={period} className={`${inputClass} sm:w-auto`}>
          {Object.entries(PERIODS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select name="format" defaultValue={format} className={`${inputClass} sm:w-auto`}>
          <option value="">Tous les formats</option>
          {Object.entries(FORMATS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select name="sort" defaultValue={sort} className={`${inputClass} sm:w-auto`}>
          {Object.entries(SORTS).map(([k, v]) => (
            <option key={k} value={k}>
              Tri : {v}
            </option>
          ))}
        </select>
        <button className={`${buttonClass.secondary} col-span-2 sm:col-span-1`}>Filtrer</button>
      </form>

      {list.length === 0 ? (
        <EmptyState title="Aucun post pour ces filtres">
          La première collecte remplit ce flux. Lance-la depuis{" "}
          <Link href="/competitors" className="text-accent hover:underline">
            Concurrents
          </Link>{" "}
          ou attends le passage automatique (tous les 2 jours).
        </EmptyState>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {list.map((p) => (
            <PostCard key={p.id} post={p} />
          ))}
        </div>
      )}
    </>
  );
}
