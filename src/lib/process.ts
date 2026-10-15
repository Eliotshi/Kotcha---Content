import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { analyzePost } from "@/lib/ai";
import { download, extractVideoAssets } from "@/lib/media";
import { fetchSubtitles, transcribeAudio } from "@/lib/transcribe";
import { env } from "@/lib/env";
import type { Json } from "@/lib/database.types";

const MAX_ATTEMPTS = 3;
const STALE_MINUTES = 15;

/** Transcrit et analyse un post. Les étapes non essentielles (miniature, audio) échouent sans bloquer l'analyse. */
export async function processPost(postId: string): Promise<void> {
  const db = createAdminClient();
  const { data: post, error } = await db
    .from("posts")
    .select("*, social_accounts!inner(handle, competitors!inner(name))")
    .eq("id", postId)
    .single();
  if (error || !post) throw new Error(`Post introuvable : ${postId}`);

  const notes: string[] = [];

  // 1. Miniature copiée dans Supabase Storage (les liens des CDN expirent).
  let thumbnail: Buffer | null = null;
  if (post.thumbnail_source_url) {
    try {
      const { buffer, contentType } = await download(post.thumbnail_source_url, 10 * 1024 * 1024);
      thumbnail = buffer;
      if (!post.thumbnail_path) {
        const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
        const objectPath = `thumbnails/${post.platform}/${post.external_id.replace(/[^\w-]/g, "_")}.${ext}`;
        const { error: uploadError } = await db.storage
          .from("media")
          .upload(objectPath, buffer, { contentType, upsert: true });
        if (!uploadError) await db.from("posts").update({ thumbnail_path: objectPath }).eq("id", post.id);
      }
    } catch (e) {
      notes.push(`miniature : ${(e as Error).message}`);
    }
  }

  // 2. Images + transcription.
  let frames: Buffer[] = [];
  let transcript: string | null = null;
  let transcriptSource = "none";

  if (post.subtitles_url) {
    transcript = await fetchSubtitles(post.subtitles_url);
    if (transcript) transcriptSource = "subtitles";
  }

  if (post.media_type === "video" && post.video_source_url) {
    try {
      const { buffer } = await download(post.video_source_url);
      const assets = await extractVideoAssets(buffer, post.duration_sec);
      frames = assets.frames;
      if (!transcript && assets.audio) {
        transcript = await transcribeAudio(assets.audio);
        if (transcript) transcriptSource = "openai";
      }
    } catch (e) {
      notes.push(`vidéo : ${(e as Error).message}`);
    }
  }
  if (!frames.length && thumbnail) frames = [thumbnail];

  // 3. Scores calculés par la vue post_feed.
  const { data: feed } = await db.from("post_feed").select("outlier_score, engagement_rate, median_perf").eq("id", post.id).maybeSingle();

  const account = post.social_accounts as unknown as { handle: string; competitors: { name: string } };
  const { analysis, model } = await analyzePost({
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
      abonnes: post.followers_at_capture,
      outlier_score: feed?.outlier_score ?? null,
      taux_engagement_pct: feed?.engagement_rate ?? null,
      mediane_du_compte: feed?.median_perf ?? null,
    },
    transcript,
    frames,
  });

  await db.from("transcripts").upsert({
    post_id: post.id,
    audio_text: transcript,
    onscreen_text: analysis.onscreen_text || null,
    source: transcriptSource,
  });

  await db.from("analyses").upsert({
    post_id: post.id,
    format: analysis.format,
    hook: analysis.hook,
    hook_type: analysis.hook_type,
    structure: analysis.structure as Json,
    theme: analysis.theme,
    cta: analysis.cta,
    tone: analysis.tone,
    target_audience: analysis.target_audience,
    why_it_works: analysis.why_it_works,
    script_reconstructed: analysis.script_reconstructed,
    ideas_for_kotcha: analysis.ideas_for_kotcha as Json,
    model,
    created_at: new Date().toISOString(),
  });

  await db
    .from("posts")
    .update({ processing_status: "done", processing_error: notes.length ? notes.join(" · ").slice(0, 1000) : null })
    .eq("id", post.id);
}

/** Réserve le prochain post à traiter (les plus récents d'abord). */
async function claimNext(): Promise<string | null> {
  const db = createAdminClient();
  const staleBefore = new Date(Date.now() - STALE_MINUTES * 60_000).toISOString();
  const { data: candidates } = await db
    .from("posts")
    .select("id, processing_status, processing_attempts, updated_at")
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
 * Traite la file jusqu'à épuisement ou jusqu'au délai imparti.
 * Renvoie `remaining: true` s'il reste du travail (l'appelant relance alors un nouveau lot).
 */
export async function processPending(options: { deadlineMs: number; max?: number }): Promise<{ processed: number; failed: number; remaining: boolean }> {
  const db = createAdminClient();
  const stopAt = Date.now() + options.deadlineMs;
  let processed = 0;
  let failed = 0;

  while (Date.now() < stopAt && processed + failed < (options.max ?? 50)) {
    const id = await claimNext();
    if (!id) return { processed, failed, remaining: false };
    try {
      await processPost(id);
      processed++;
    } catch (e) {
      failed++;
      await db
        .from("posts")
        .update({ processing_status: "failed", processing_error: ((e as Error).message ?? String(e)).slice(0, 1000) })
        .eq("id", id);
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
