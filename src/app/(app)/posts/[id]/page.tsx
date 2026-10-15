import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, fmtDuration, fmtNumber, fmtPercent, fmtScore } from "@/lib/format";
import { FORMATS, HOOK_TYPES, label, PROCESSING_LABEL } from "@/lib/labels";
import { MetricsChart } from "@/components/metrics-chart";
import { Thumbnail } from "@/components/post-card";
import { PlatformTag } from "@/components/platform-icon";
import { Badge, buttonClass, Card, CompetitorDot, inputClass, OutlierBadge, PostFlags, SectionTitle, StatTile } from "@/components/ui";
import { ActionButton } from "@/components/action-button";
import { SubmitButton } from "@/components/submit-button";
import { correctAnalysis, reprocessPost } from "../../actions";

export const metadata: Metadata = { title: "Post" };

type Beat = { t: string; beat: string; content: string };

export default async function PostPage({ params }: PageProps<"/posts/[id]">) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: post }, { data: raw }, { data: analysis }, { data: transcript }, { data: metrics }] = await Promise.all([
    supabase.from("post_feed").select("*").eq("id", id).maybeSingle(),
    supabase.from("posts").select("processing_error, music, analysis_inputs, perf_baseline").eq("id", id).maybeSingle(),
    supabase.from("analyses").select("*").eq("post_id", id).maybeSingle(),
    supabase.from("transcripts").select("*").eq("post_id", id).maybeSingle(),
    supabase.from("post_metrics").select("captured_at, views, likes, comments, shares").eq("post_id", id).order("captured_at"),
  ]);
  if (!post) notFound();

  const hasViews = post.perf_metric ? post.perf_metric === "views" : post.views !== null;
  const series = (metrics ?? []).map((m) => ({
    t: m.captured_at,
    value: hasViews ? (m.views ?? 0) : (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0),
  }));
  const structure = (analysis?.structure as Beat[] | null) ?? [];
  const ideas = (analysis?.ideas_for_kotcha as string[] | null) ?? [];
  const reprocess = reprocessPost.bind(null, id);
  const correct = correctAnalysis.bind(null, id);
  const inputs = (raw?.analysis_inputs ?? null) as { gaps?: string[]; frames?: number; frames_source?: string; transcript_source?: string | null } | null;
  const age = post.perf_age_hours;
  const metricLabel = hasViews ? "vues" : "interactions";

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
          {post.url && /^https?:\/\//.test(post.url) && (
            <a href={post.url} target="_blank" rel="noopener noreferrer" className={buttonClass.secondary}>
              Voir le post original ↗
            </a>
          )}
          <Link href={`/scripts/new?posts=${id}`} className={buttonClass.primary}>
            Créer un script Kotcha inspiré
          </Link>
          <ActionButton action={reprocess} className={`${buttonClass.ghost} w-full`} pendingLabel="Relance…">
            Relancer l&apos;analyse
          </ActionButton>
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
              <OutlierBadge score={post.outlier_score} confidence={post.perf_confidence} ageHours={post.perf_age_hours} showMissing />
              <PostFlags pinned={post.is_pinned} paid={post.is_paid_partnership} collab={post.is_collab} />
              {post.processing_status !== "done" && (
                <Badge tone={post.processing_status === "failed" ? "critical" : "warning"}>
                  {label(PROCESSING_LABEL, post.processing_status)}
                </Badge>
              )}
            </div>
            {analysis?.hook && <h1 className="mt-3 text-xl font-semibold tracking-tight text-text">« {analysis.hook} »</h1>}
            {raw?.processing_error && <p className="mt-2 text-xs text-critical">Dernière erreur de traitement : {raw.processing_error}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile
              label={hasViews ? "Vues" : "Interactions"}
              value={fmtNumber(post.perf)}
              hint={age !== null ? `au relevé, ${Math.round(age)} h après publication` : undefined}
            />
            <StatTile
              label="Score à âge égal"
              value={fmtScore(post.outlier_score)}
              hint={
                post.outlier_score !== null
                  ? `vs ${fmtNumber(post.median_perf)} ${metricLabel} (médiane de ${post.perf_sample} posts au même âge)${post.perf_estimated ? " · référence estimée" : ""}`
                  : `historique insuffisant (${post.perf_sample ?? 0}/3 posts comparables)`
              }
            />
            <StatTile
              label="Rythme"
              value={post.perf_per_hour !== null ? `${fmtNumber(post.perf_per_hour)}/h` : "—"}
              hint={`${metricLabel} par heure depuis la publication`}
            />
            <StatTile
              label="Engagement"
              value={fmtPercent(post.engagement_rate)}
              hint={post.engagement_basis === "per_view" ? "(likes + comm. + partages + enreg.) / vues" : "(likes + comm. + partages) / abonnés"}
            />
          </div>
          <Card className="p-4">
            <SectionTitle>{hasViews ? "Vues" : "Interactions"} au fil des relevés</SectionTitle>
            <MetricsChart points={series} metricLabel={hasViews ? "Vues" : "Interactions"} />
          </Card>

          {analysis ? (
            <Card className="p-4">
              <SectionTitle
                action={
                  <span className="flex items-center gap-2">
                    {post.analysis_quality === "partial" && <Badge tone="warning">Analyse partielle</Badge>}
                    {analysis.confidence && (
                      <Badge tone={analysis.confidence === "low" ? "warning" : "neutral"}>
                        Fiabilité : {analysis.confidence === "high" ? "bonne" : analysis.confidence === "medium" ? "moyenne" : "faible"}
                      </Badge>
                    )}
                  </span>
                }
              >
                Analyse IA
              </SectionTitle>
              {inputs?.gaps && inputs.gaps.length > 0 && (
                <p className="mb-3 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
                  Éléments manquants : {inputs.gaps.join(" · ")}. Les conclusions ci-dessous sont à vérifier sur le post original.
                </p>
              )}
              {analysis.suspicious_content && (
                <p className="mb-3 rounded-lg bg-critical-soft px-3 py-2 text-xs text-critical">
                  Le contenu de ce post contient des instructions adressées à une IA : elles ont été ignorées, mais vérifie l&apos;analyse.
                </p>
              )}
              <div className="mb-4 flex flex-wrap gap-2">
                <Badge tone="accent">{label(FORMATS, analysis.format)}</Badge>
                <Badge>Hook : {label(HOOK_TYPES, analysis.hook_type)}</Badge>
                {analysis.theme && <Badge>{analysis.theme}</Badge>}
                {analysis.tone && <Badge>Ton : {analysis.tone}</Badge>}
              </div>
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-text-2">Hypothèses sur la performance (non vérifiées)</dt>
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
              {analysis.uncertainties && (
                <p className="mt-4 text-xs text-text-2">
                  <span className="font-medium">Incertitudes :</span> {analysis.uncertainties}
                </p>
              )}
              <form action={correct} className="mt-5 flex flex-wrap items-end gap-2 border-t border-border pt-4">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-text-2">Format</span>
                  <select name="format" defaultValue={analysis.format ?? "other"} className={`${inputClass} w-auto`}>
                    {Object.entries(FORMATS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-text-2">Type de hook</span>
                  <select name="hook_type" defaultValue={analysis.hook_type ?? "other"} className={`${inputClass} w-auto`}>
                    {Object.entries(HOOK_TYPES).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <SubmitButton className={buttonClass.secondary} pendingLabel="…">
                  Corriger
                </SubmitButton>
                {analysis.format_locked && <span className="text-xs text-muted">Corrigé à la main{analysis.edited_at ? ` le ${fmtDate(analysis.edited_at)}` : ""}</span>}
              </form>
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
                <div className="mb-1 text-xs text-text-2">
                  Script reconstitué {transcript?.audio_text ? "" : "(sans audio : paroles inconnues)"}
                </div>
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
