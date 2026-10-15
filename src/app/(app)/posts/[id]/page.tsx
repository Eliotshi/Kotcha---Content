import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, fmtDuration, fmtNumber, fmtPercent, fmtScore } from "@/lib/format";
import { FORMATS, HOOK_TYPES, label, PROCESSING_LABEL } from "@/lib/labels";
import { MetricsChart } from "@/components/metrics-chart";
import { Thumbnail } from "@/components/post-card";
import { PlatformTag } from "@/components/platform-icon";
import { Badge, buttonClass, Card, CompetitorDot, OutlierBadge, SectionTitle, StatTile } from "@/components/ui";
import { reprocessPost } from "../../actions";

export const metadata: Metadata = { title: "Post" };

type Beat = { t: string; beat: string; content: string };

export default async function PostPage({ params }: PageProps<"/posts/[id]">) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: post }, { data: raw }, { data: analysis }, { data: transcript }, { data: metrics }] = await Promise.all([
    supabase.from("post_feed").select("*").eq("id", id).maybeSingle(),
    supabase.from("posts").select("processing_error, music, video_source_url").eq("id", id).maybeSingle(),
    supabase.from("analyses").select("*").eq("post_id", id).maybeSingle(),
    supabase.from("transcripts").select("*").eq("post_id", id).maybeSingle(),
    supabase.from("post_metrics").select("captured_at, views, likes, comments, shares").eq("post_id", id).order("captured_at"),
  ]);
  if (!post) notFound();

  const hasViews = post.views !== null;
  const series = (metrics ?? []).map((m) => ({
    t: m.captured_at,
    value: hasViews ? (m.views ?? 0) : (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0),
  }));
  const structure = (analysis?.structure as Beat[] | null) ?? [];
  const ideas = (analysis?.ideas_for_kotcha as string[] | null) ?? [];
  const reprocess = reprocessPost.bind(null, id);

  return (
    <>
      <div className="mb-4">
        <Link href="/" className="text-sm text-text-2 hover:text-text">
          ← Veille
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="flex flex-col gap-3">
          <Card className="overflow-hidden">
            <Thumbnail post={post} className="aspect-[4/5] w-full" />
          </Card>
          {post.url && (
            <a href={post.url} target="_blank" rel="noreferrer" className={buttonClass.secondary}>
              Voir le post original ↗
            </a>
          )}
          <Link href={`/scripts/new?posts=${id}`} className={buttonClass.primary}>
            Créer un script Kotcha inspiré
          </Link>
          <form action={reprocess}>
            <button className={`${buttonClass.ghost} w-full`}>Relancer l&apos;analyse</button>
          </form>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-text-2">
              <span className="inline-flex items-center gap-1.5 font-medium text-text">
                <CompetitorDot color={post.competitor_color} />
                {post.competitor_name}
              </span>
              <PlatformTag platform={post.platform} />
              <span>{fmtDate(post.published_at, true)}</span>
              {fmtDuration(post.duration_sec) && <span>· {fmtDuration(post.duration_sec)}</span>}
              <OutlierBadge score={post.outlier_score} />
              {post.processing_status !== "done" && (
                <Badge tone={post.processing_status === "failed" ? "critical" : "warning"}>
                  {label(PROCESSING_LABEL, post.processing_status)}
                </Badge>
              )}
            </div>
            {analysis?.hook && <h1 className="mt-3 text-xl font-semibold tracking-tight text-text">« {analysis.hook} »</h1>}
            {raw?.processing_error && <p className="mt-2 text-xs text-muted">Note de traitement : {raw.processing_error}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label={hasViews ? "Vues" : "Interactions"} value={fmtNumber(post.perf)} hint={`médiane du compte : ${fmtNumber(post.median_perf)}`} />
            <StatTile label="Surperformance" value={fmtScore(post.outlier_score)} hint="vs médiane des 30 derniers posts" />
            <StatTile label="Engagement" value={fmtPercent(post.engagement_rate)} hint="(likes + comm. + partages) / abonnés" />
            <StatTile
              label="Likes · comm. · partages"
              value={<span className="text-lg">{`${fmtNumber(post.likes)} · ${fmtNumber(post.comments)} · ${fmtNumber(post.shares)}`}</span>}
              hint={post.saves !== null ? `${fmtNumber(post.saves)} enregistrements` : undefined}
            />
          </div>

          <Card className="p-4">
            <SectionTitle>{hasViews ? "Vues" : "Interactions"} au fil des relevés</SectionTitle>
            <MetricsChart points={series} metricLabel={hasViews ? "Vues" : "Interactions"} />
          </Card>

          {analysis ? (
            <Card className="p-4">
              <SectionTitle>Analyse</SectionTitle>
              <div className="mb-4 flex flex-wrap gap-2">
                <Badge tone="accent">{label(FORMATS, analysis.format)}</Badge>
                <Badge>Hook : {label(HOOK_TYPES, analysis.hook_type)}</Badge>
                {analysis.theme && <Badge>{analysis.theme}</Badge>}
                {analysis.tone && <Badge>Ton : {analysis.tone}</Badge>}
              </div>
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-text-2">Pourquoi ça marche</dt>
                  <dd className="mt-1 text-text">{analysis.why_it_works}</dd>
                </div>
                <div>
                  <dt className="text-xs text-text-2">Cible · CTA</dt>
                  <dd className="mt-1 text-text">
                    {analysis.target_audience}
                    <br />
                    <span className="text-text-2">CTA :</span> {analysis.cta}
                  </dd>
                </div>
              </dl>
              {structure.length > 0 && (
                <ol className="mt-5 flex flex-col gap-2 border-t border-border pt-4">
                  {structure.map((b, i) => (
                    <li key={i} className="grid grid-cols-[64px_1fr] gap-3 text-sm">
                      <span className="text-xs text-muted tabular">{b.t}</span>
                      <span>
                        <span className="font-medium text-text">{b.beat}</span>
                        <span className="text-text-2"> — {b.content}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {ideas.length > 0 && (
                <div className="mt-5 border-t border-border pt-4">
                  <div className="mb-2 text-xs text-text-2">Idées pour Kotcha</div>
                  <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-text">
                    {ideas.map((idea, i) => (
                      <li key={i}>{idea}</li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          ) : (
            <Card className="p-4 text-sm text-text-2">
              L&apos;analyse IA n&apos;est pas encore disponible ({label(PROCESSING_LABEL, post.processing_status)}).
            </Card>
          )}

          <Card className="p-4">
            <SectionTitle>Script</SectionTitle>
            <div className="grid gap-4 text-sm lg:grid-cols-2">
              <div>
                <div className="mb-1 text-xs text-text-2">Script reconstitué</div>
                <p className="whitespace-pre-wrap text-text">{analysis?.script_reconstructed || "—"}</p>
              </div>
              <div className="flex flex-col gap-4">
                <div>
                  <div className="mb-1 text-xs text-text-2">
                    Transcription audio {transcript?.source && transcript.source !== "none" ? `(${transcript.source === "subtitles" ? "sous-titres TikTok" : "speech-to-text"})` : ""}
                  </div>
                  <p className="whitespace-pre-wrap text-text">{transcript?.audio_text || "—"}</p>
                </div>
                <div>
                  <div className="mb-1 text-xs text-text-2">Texte à l&apos;écran</div>
                  <p className="whitespace-pre-wrap text-text">{transcript?.onscreen_text || "—"}</p>
                </div>
                <div>
                  <div className="mb-1 text-xs text-text-2">Légende</div>
                  <p className="whitespace-pre-wrap text-text-2">{post.caption || "—"}</p>
                </div>
                {raw?.music && (
                  <div>
                    <div className="mb-1 text-xs text-text-2">Son</div>
                    <p className="text-text">{raw.music}</p>
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
