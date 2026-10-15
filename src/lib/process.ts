import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { analyzePost } from "@/lib/ai";
import { download, DownloadError, extractVideoAssets } from "@/lib/media";
import { fetchSubtitles, transcribeAudio } from "@/lib/transcribe";
import { requestMedia } from "@/lib/collect";
import { recordUsage, withinBudget } from "@/lib/budget";
import { raiseAlert } from "@/lib/alerts";
import { env } from "@/lib/env";
import type { Json } from "@/lib/database.types";

const MAX_ATTEMPTS = 3;
const STALE_MINUTES = 15;

type Outcome = "done" | "deferred";

/**
 * Transcrit et analyse un post. Les étapes non essentielles (miniature, audio) échouent sans bloquer l'analyse,
 * mais l'analyse est alors marquée « partielle » avec la raison, au lieu de passer pour complète.
 */
export async function processPost(postId: string): Promise<Outcome> {
  const db = createAdminClient();
  const { data: post, error } = await db
    .from("posts")
    .select("*, social_accounts!inner(handle, competitors!inner(name))")
    .eq("id", postId)
    .single();
  if (error || !post) throw new Error(`Post introuvable : ${postId}`);

  const gaps: string[] = [];

  // 1. Miniature copiée dans Supabase Storage (les liens des CDN expirent).
  let thumbnail: Buffer | null = null;
  if (post.thumbnail_source_url) {
    try {
      const { buffer, contentType } = await download(post.thumbnail_source_url, 10 * 1024 * 1024);
      thumbnail = buffer;
      if (!post.thumbnail_path) {
        const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
        const objectPath = `thumbnails/${post.platform}/${post.external_id.replace(/[^\w-]/g, "_")}.${ext}`;
        const { error: uploadError } = await db.storage.from("media").upload(objectPath, buffer, { contentType, upsert: true });
        if (!uploadError) await db.from("posts").update({ thumbnail_path: objectPath }).eq("id", post.id);
      }
    } catch {
      gaps.push("miniature indisponible");
    }
  }

  // 2. Images + transcription.
  let frames: Buffer[] = [];
  let framesSource: "video" | "cover" | "none" = "none";
  let transcript: string | null = null;
  let transcriptSource: string | null = null;

  if (post.subtitles_url) {
    transcript = await fetchSubtitles(post.subtitles_url);
    if (transcript) transcriptSource = "subtitles";
  }

  const isVideo = post.media_type === "video";
  if (isVideo && post.video_source_url) {
    try {
      const { buffer } = await download(post.video_source_url);
      const assets = await extractVideoAssets(buffer, post.duration_sec);
      frames = assets.frames;
      if (frames.length) framesSource = "video";
      if (!transcript && assets.audio) {
        transcript = await transcribeAudio(assets.audio);
        if (transcript) {
          transcriptSource = "openai";
          await recordUsage({
            kind: "transcription",
            costUsd: (Math.max(post.duration_sec ?? 60, 1) / 60) * env.transcriptionUsdPerMin(),
            refId: post.id,
          });
        }
      }
    } catch (e) {
      // Lien expiré : on redemande un lien frais une fois (collecte média ciblée), puis on réessaie.
      if (e instanceof DownloadError && e.expired && post.media_refresh_count < 1 && post.platform !== "linkedin") {
        if (await requestMedia(post.platform, [{ id: post.id, url: post.url }])) {
          await db.from("posts").update({ processing_status: "pending", processing_attempts: post.processing_attempts - 1 }).eq("id", post.id);
          return "deferred";
        }
      }
      gaps.push(e instanceof DownloadError && e.expired ? "lien vidéo expiré" : "vidéo non téléchargée");
    }
  } else if (isVideo) {
    gaps.push("vidéo non fournie par la collecte");
  }

  if (!frames.length && thumbnail) {
    frames = [thumbnail];
    framesSource = "cover";
  }
  if (isVideo && framesSource !== "video") gaps.push("analyse visuelle sur la miniature seulement");
  if (isVideo && !transcript) gaps.push(env.openaiKey() ? "pas de piste audio exploitable" : "pas de transcription audio (clé OpenAI absente)");

  const account = post.social_accounts as unknown as { handle: string; competitors: { name: string } };
  const { analysis, model, costUsd } = await analyzePost({
    platform: post.platform,
    competitor: account.competitors.name,
    mediaType: post.media_type,
    caption: post.caption,
    hashtags: post.hashtags,
    durationSec: post.duration_sec,
    publishedAt: post.published_at,
    metrics: {
      vues: post.views,
      likes: post.likes,
      commentaires: post.comments,
      partages: post.shares,
      enregistrements: post.saves,
      age_heures_au_releve: post.perf_age_hours,
      score_a_age_egal: post.perf_score,
      reference_a_age_egal: post.perf_baseline,
      nb_posts_de_reference: post.perf_sample,
    },
    transcript,
    transcriptSource,
    frames,
    framesSource,
  });
  await recordUsage({ kind: "ai_analysis", costUsd, refId: post.id, meta: { model } });

  await db.from("transcripts").upsert({
    post_id: post.id,
    audio_text: transcript,
    onscreen_text: analysis.onscreen_text || null,
    source: transcriptSource ?? "none",
  });

  // Une correction manuelle du format / type de hook n'est pas écrasée par une ré-analyse.
  const { data: previous } = await db.from("analyses").select("format_locked, format, hook_type").eq("post_id", post.id).maybeSingle();
  const locked = previous?.format_locked ?? false;

  await db.from("analyses").upsert({
    post_id: post.id,
    format: locked ? previous!.format : analysis.format,
    hook: analysis.hook,
    hook_type: locked ? previous!.hook_type : analysis.hook_type,
    structure: analysis.structure as Json,
    theme: analysis.theme,
    cta: analysis.cta,
    tone: analysis.tone,
    target_audience: analysis.target_audience,
    why_it_works: analysis.why_it_works,
    script_reconstructed: analysis.script_reconstructed,
    ideas_for_kotcha: analysis.ideas_for_kotcha as Json,
    confidence: analysis.confidence,
    uncertainties: analysis.uncertainties || null,
    suspicious_content: analysis.suspicious_content,
    format_locked: locked,
    model,
    created_at: new Date().toISOString(),
  });

  await db
    .from("posts")
    .update({
      processing_status: "done",
      processing_error: null,
      analysis_quality: gaps.length ? "partial" : "full",
      analysis_inputs: { frames: frames.length, frames_source: framesSource, transcript_source: transcriptSource, gaps } as Json,
    })
    .eq("id", post.id);
  return "done";
}

/** Réserve le prochain post à traiter (les plus récents d'abord), uniquement si ses médias sont prêts. */
async function claimNext(): Promise<string | null> {
  const db = createAdminClient();
  const staleBefore = new Date(Date.now() - STALE_MINUTES * 60_000).toISOString();
  const { data: candidates } = await db
    .from("posts")
    .select("id, processing_status, processing_attempts, updated_at")
    .eq("media_ready", true)
    .or(`processing_status.eq.pending,processing_status.eq.failed,and(processing_status.eq.processing,updated_at.lt.${staleBefore})`)
    .lt("processing_attempts", MAX_ATTEMPTS)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(5);

  for (const c of candidates ?? []) {
    const { data } = await db
      .from("posts")
      .update({ processing_status: "processing", processing_attempts: c.processing_attempts + 1 })
      .eq("id", c.id)
      .eq("updated_at", c.updated_at) // verrou optimiste : un autre worker n'a pas pris ce post entre-temps
      .select("id")
      .maybeSingle();
    if (data) return data.id;
  }
  return null;
}

/**
 * Traite la file jusqu'à épuisement, au délai imparti ou au plafond de budget IA.
 * Renvoie `remaining: true` s'il reste du travail (l'appelant relance alors un nouveau lot).
 */
export async function processPending(options: { deadlineMs: number; max?: number }): Promise<{ processed: number; failed: number; remaining: boolean }> {
  const db = createAdminClient();
  const stopAt = Date.now() + options.deadlineMs;
  let processed = 0;
  let failed = 0;

  while (Date.now() < stopAt && processed + failed < (options.max ?? 50)) {
    if (!(await withinBudget("ai"))) return { processed, failed, remaining: false };
    const id = await claimNext();
    if (!id) return { processed, failed, remaining: false };
    try {
      await processPost(id);
      processed++;
    } catch (e) {
      failed++;
      const message = ((e as Error).message ?? String(e)).slice(0, 1000);
      const { data: post } = await db
        .from("posts")
        .update({ processing_status: "failed", processing_error: message })
        .eq("id", id)
        .select("processing_attempts")
        .single();
      if ((post?.processing_attempts ?? 0) >= MAX_ATTEMPTS) {
        await raiseAlert({
          level: "warning",
          kind: "analysis_failed",
          message: `Analyse abandonnée après ${MAX_ATTEMPTS} tentatives : ${message.slice(0, 200)}`,
          dedupeKey: `analysis_failed:${id}`,
          ref: { post_id: id },
        });
      }
    }
  }
  return { processed, failed, remaining: true };
}

/** Relance le traitement dans une nouvelle invocation serverless (sans attendre la réponse). */
export async function triggerProcessing(): Promise<void> {
  try {
    await fetch(`${env.appUrl()}/api/jobs/process`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.jobsSecret()}` },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // Timeout attendu : la fonction appelée continue de tourner de son côté. Le cron quotidien rattrape le reste.
  }
}
