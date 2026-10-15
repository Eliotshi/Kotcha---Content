import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { daysAgoIso, fmtNumber, fmtRelative, fmtScore } from "@/lib/format";
import { FORMATS, label } from "@/lib/labels";
import { PLATFORM_LABEL, PLATFORMS } from "@/lib/platforms";
import { PostCard } from "@/components/post-card";
import { buttonClass, EmptyState, inputClass, PageHeader, StatTile } from "@/components/ui";
import { processQueueNow } from "./actions";

export const metadata: Metadata = { title: "Veille" };

const PERIODS = { "7": "7 jours", "30": "30 jours", "90": "90 jours", all: "Tout" } as const;
const SORTS = { recent: "Plus récents", outlier: "Surperformance", views: "Vues", engagement: "Engagement" } as const;

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
  const period = (one("period") || "30") as keyof typeof PERIODS;
  const sort = (one("sort") || "recent") as keyof typeof SORTS;

  const supabase = await createClient();
  let query = supabase.from("post_feed").select("*").limit(200);
  if (platform && PLATFORMS.includes(platform as never)) query = query.eq("platform", platform as never);
  if (competitor) query = query.eq("competitor_id", competitor);
  if (format) query = query.eq("format", format);
  if (period !== "all" && PERIODS[period]) {
    query = query.gte("published_at", daysAgoIso(Number(period)));
  }
  query =
    sort === "outlier"
      ? query.order("outlier_score", { ascending: false, nullsFirst: false })
      : sort === "views"
        ? query.order("perf", { ascending: false, nullsFirst: false })
        : sort === "engagement"
          ? query.order("engagement_rate", { ascending: false, nullsFirst: false })
          : query.order("published_at", { ascending: false, nullsFirst: false });

  const [{ data: posts }, { data: competitors }, { data: lastRun }, { count: queued }] = await Promise.all([
    query,
    supabase.from("competitors").select("id, name").order("name"),
    supabase.from("scrape_runs").select("finished_at, started_at").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("posts").select("id", { count: "exact", head: true }).in("processing_status", ["pending", "processing"]),
  ]);

  const list = posts ?? [];
  const outliers = list.filter((p) => (p.outlier_score ?? 0) >= 2);
  const medianViews = median(list.filter((p) => p.views !== null).map((p) => p.views!));

  // Format gagnant : meilleure surperformance moyenne (au moins 2 posts analysés).
  const byFormat = new Map<string, number[]>();
  for (const p of list) if (p.format && p.outlier_score !== null) byFormat.set(p.format, [...(byFormat.get(p.format) ?? []), p.outlier_score]);
  const best = [...byFormat.entries()]
    .filter(([, scores]) => scores.length >= 2)
    .map(([f, scores]) => ({ f, avg: scores.reduce((a, b) => a + b, 0) / scores.length, n: scores.length }))
    .sort((a, b) => b.avg - a.avg)[0];

  return (
    <>
      <PageHeader
        title="Veille concurrents"
        subtitle={<>Dernière collecte : {fmtRelative(lastRun?.finished_at ?? lastRun?.started_at)}</>}
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

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Posts sur la période" value={fmtNumber(list.length)} hint={PERIODS[period] ?? ""} />
        <StatTile label="Posts à plus de 2× leur moyenne" value={fmtNumber(outliers.length)} hint="à regarder en priorité" />
        <StatTile label="Vues médianes (vidéos)" value={fmtNumber(medianViews)} hint="Instagram et TikTok" />
        <StatTile
          label="Format qui surperforme"
          value={<span className="text-lg">{best ? label(FORMATS, best.f) : "—"}</span>}
          hint={best ? `${fmtScore(best.avg)} en moyenne sur ${best.n} posts` : "pas encore assez d'analyses"}
        />
      </div>

      <form className="mb-5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center" method="get">
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
