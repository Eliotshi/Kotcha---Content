import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { getDatasetItems, getRun, startActorRun } from "@/lib/apify";
import { buildActorInput, buildMediaInput, normalizeItems, PLATFORM_LABEL, type Platform } from "@/lib/platforms";
import { assessQuality, qualityJson } from "@/lib/quality";
import { recomputeAccountScores } from "@/lib/scoring";
import { withinBudget } from "@/lib/budget";
import { raiseAlert, resolveAlerts } from "@/lib/alerts";

export type CollectResult = { started: number; errors: string[]; skipped?: string };

function webhookUrl() {
  return `${env.appUrl()}/api/webhooks/apify`;
}

/**
 * Lance un run Apify par compte actif (un run par compte : le rattachement des posts
 * au bon compte est trivial, et un compte en échec ne bloque pas les autres).
 */
export async function startCollection(options: { trigger: "cron" | "manual"; accountIds?: string[] }): Promise<CollectResult> {
  if (!(await withinBudget("apify"))) {
    return { started: 0, errors: [], skipped: "Plafond mensuel Apify atteint : collecte suspendue." };
  }

  const db = createAdminClient();
  let query = db.from("social_accounts").select("id, platform, handle").eq("active", true);
  if (options.accountIds?.length) query = query.in("id", options.accountIds);
  const { data: accounts, error } = await query;
  if (error) throw error;

  const limit = env.postsPerAccount();
  const result: CollectResult = { started: 0, errors: [] };

  for (const account of accounts ?? []) {
    const actorId = env.actor(account.platform);
    try {
      const run = await startActorRun(actorId, buildActorInput(account.platform, account.handle, limit), webhookUrl());
      await db.from("scrape_runs").insert({
        platform: account.platform,
        apify_run_id: run.id,
        actor_id: actorId,
        account_ids: [account.id],
        status: run.status,
        trigger: options.trigger,
      });
      result.started++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      result.errors.push(`${account.platform}/${account.handle}: ${message}`);
      await db.from("scrape_runs").insert({
        platform: account.platform,
        actor_id: actorId,
        account_ids: [account.id],
        status: "FAILED",
        error: message.slice(0, 1000),
        trigger: options.trigger,
        finished_at: new Date().toISOString(),
      });
      await raiseAlert({
        level: "warning",
        kind: "collect_start",
        message: `Impossible de lancer la collecte ${PLATFORM_LABEL[account.platform]} @${account.handle} : ${message.slice(0, 200)}`,
        dedupeKey: `collect_start:${account.id}`,
      });
    }
  }
  return result;
}

/**
 * Collecte « média » pour des posts précis (vidéos TikTok des nouveaux posts, liens Instagram expirés).
 * Les posts restent hors de la file d'analyse (media_ready = false) jusqu'au retour du run.
 */
export async function requestMedia(platform: Platform, posts: { id: string; url: string | null }[]): Promise<boolean> {
  const withUrl = posts.filter((p): p is { id: string; url: string } => Boolean(p.url));
  const input = buildMediaInput(platform, withUrl.map((p) => p.url));
  if (!input || !(await withinBudget("apify"))) return false;

  const db = createAdminClient();
  const actorId = env.actor(platform);
  try {
    const run = await startActorRun(actorId, input, webhookUrl());
    await db.from("scrape_runs").insert({
      platform,
      purpose: "media",
      apify_run_id: run.id,
      actor_id: actorId,
      post_ids: withUrl.map((p) => p.id),
      status: run.status,
      trigger: "auto",
    });
    for (const p of withUrl) {
      const { data } = await db.from("posts").select("media_refresh_count").eq("id", p.id).single();
      await db
        .from("posts")
        .update({ media_ready: false, media_refresh_count: (data?.media_refresh_count ?? 0) + 1 })
        .eq("id", p.id);
    }
    return true;
  } catch (e) {
    await raiseAlert({
      level: "warning",
      kind: "media_start",
      message: `Collecte média ${PLATFORM_LABEL[platform]} impossible : ${(e as Error).message.slice(0, 200)}`,
      dedupeKey: `media_start:${platform}:${new Date().toISOString().slice(0, 10)}`,
    });
    return false;
  }
}

export type IngestResult = { items: number; newPosts: number; skipped?: boolean; purpose?: string };

/**
 * Importe les résultats d'un run Apify terminé. Idempotent : un webhook rejoué (Apify réessaie
 * en cas de délai) est ignoré grâce à la réservation atomique du run, et les relevés sont uniques
 * par (post, collecte).
 */
export async function ingestRun(apifyRunId: string): Promise<IngestResult> {
  const db = createAdminClient();

  // Réservation atomique : une seule invocation traite ce run.
  const { data: scrapeRun } = await db
    .from("scrape_runs")
    .update({ status: "INGESTING" })
    .eq("apify_run_id", apifyRunId)
    .not("status", "in", '("SUCCEEDED","INGESTING")')
    .select("*")
    .maybeSingle();
  if (!scrapeRun) {
    const { data: known } = await db.from("scrape_runs").select("id").eq("apify_run_id", apifyRunId).maybeSingle();
    if (!known) throw new Error(`Run Apify inconnu : ${apifyRunId}`);
    return { items: 0, newPosts: 0, skipped: true };
  }

  try {
    // On relit le run chez Apify plutôt que de faire confiance au contenu du webhook.
    const run = await getRun(apifyRunId);
    if (run.status !== "SUCCEEDED") {
      await db
        .from("scrape_runs")
        .update({ status: run.status, health: "error", cost_usd: run.usageTotalUsd ?? null, finished_at: run.finishedAt ?? new Date().toISOString() })
        .eq("id", scrapeRun.id);
      if (scrapeRun.purpose === "media") {
        // On analyse quand même, sans la vidéo (analyse marquée partielle).
        await db.from("posts").update({ media_ready: true }).in("id", scrapeRun.post_ids);
      }
      await raiseAlert({
        level: "warning",
        kind: "collect_failed",
        message: `Collecte ${scrapeRun.purpose === "media" ? "média " : ""}${PLATFORM_LABEL[scrapeRun.platform]} terminée en ${run.status}.`,
        dedupeKey: `collect_failed:${scrapeRun.account_ids[0] ?? scrapeRun.platform}:${scrapeRun.purpose}`,
      });
      return { items: 0, newPosts: 0, purpose: scrapeRun.purpose };
    }

    const items = await getDatasetItems(run.defaultDatasetId);
    const result =
      scrapeRun.purpose === "media"
        ? await ingestMedia(scrapeRun.platform, scrapeRun.post_ids, items)
        : await ingestPosts(scrapeRun.id, scrapeRun.platform, scrapeRun.account_ids[0], items);

    await db
      .from("scrape_runs")
      .update({
        status: run.status,
        items_count: items.length,
        new_posts: result.newPosts,
        cost_usd: run.usageTotalUsd ?? null,
        finished_at: run.finishedAt ?? new Date().toISOString(),
        quality: result.quality ?? null,
        health: result.health ?? "ok",
      })
      .eq("id", scrapeRun.id);
    return { items: items.length, newPosts: result.newPosts, purpose: scrapeRun.purpose };
  } catch (e) {
    // Statut d'erreur (≠ INGESTING) : un nouvel envoi du webhook pourra retenter l'import.
    await db
      .from("scrape_runs")
      .update({ status: "INGEST_ERROR", error: ((e as Error).message ?? String(e)).slice(0, 1000) })
      .eq("id", scrapeRun.id);
    throw e;
  }
}

async function ingestPosts(scrapeRunId: string, platform: Platform, accountId: string, items: Record<string, unknown>[]) {
  const db = createAdminClient();
  const posts = normalizeItems(platform, items);
  const quality = assessQuality(platform, items, posts);
  const now = new Date().toISOString();

  const { data: account } = await db.from("social_accounts").select("handle").eq("id", accountId).single();
  const accountLabel = `${PLATFORM_LABEL[platform]} @${account?.handle ?? "?"}`;
  if (quality.health === "ok") {
    await resolveAlerts(`quality:${accountId}`);
  } else {
    await raiseAlert({
      level: quality.health === "error" ? "critical" : "warning",
      kind: "data_quality",
      message: `Qualité de collecte ${accountLabel} : ${quality.issues.join(" ; ")}`,
      dedupeKey: `quality:${accountId}`,
    });
  }

  const externalIds = posts.map((p) => p.external_id);
  const { data: existing } = externalIds.length
    ? await db.from("posts").select("external_id").eq("platform", platform).in("external_id", externalIds)
    : { data: [] };
  const known = new Set((existing ?? []).map((p) => p.external_id));
  const followers = posts.find((p) => p.followers)?.followers ?? null;

  const rows = posts.map(({ followers: postFollowers, ...p }) => ({
    ...p,
    account_id: accountId,
    followers_at_capture: postFollowers ?? followers,
    metrics_updated_at: now,
  }));

  // TikTok : la vidéo n'est téléchargée que pour les nouveaux posts (collecte média ciblée).
  const needsMedia = platform === "tiktok";
  const fresh = rows
    .filter((r) => !known.has(r.external_id))
    .map((r) => ({ ...r, processing_status: "pending" as const, media_ready: !(needsMedia && r.media_type === "video") }));
  const refreshed = rows.filter((r) => known.has(r.external_id));

  const upserted: { id: string; external_id: string; url: string | null; media_ready: boolean; views: number | null; likes: number | null; comments: number | null; shares: number | null; saves: number | null; followers_at_capture: number | null }[] = [];
  for (const batch of [fresh, refreshed]) {
    if (!batch.length) continue;
    const { data, error } = await db
      .from("posts")
      .upsert(batch, { onConflict: "platform,external_id" })
      .select("id, external_id, url, media_ready, views, likes, comments, shares, saves, followers_at_capture");
    if (error) throw error;
    upserted.push(...(data ?? []));
  }

  if (upserted.length) {
    await db.from("post_metrics").upsert(
      upserted.map((p) => ({
        post_id: p.id,
        scrape_run_id: scrapeRunId,
        captured_at: now,
        views: p.views,
        likes: p.likes,
        comments: p.comments,
        shares: p.shares,
        saves: p.saves,
        followers: p.followers_at_capture,
      })),
      { onConflict: "post_id,scrape_run_id", ignoreDuplicates: true },
    );
  }

  await db
    .from("social_accounts")
    .update({ last_scraped_at: now, ...(followers ? { followers } : {}) })
    .eq("id", accountId);

  await recomputeAccountScores(accountId);

  // Seuls les nouveaux posts déclenchent une collecte média (un post déjà en attente n'est pas redemandé).
  const freshIds = new Set(fresh.map((r) => r.external_id));
  const waiting = upserted.filter((p) => !p.media_ready && freshIds.has(p.external_id));
  if (waiting.length && !(await requestMedia(platform, waiting))) {
    // Pas de collecte média possible (plafond, erreur) : analyse sans la vidéo plutôt que blocage.
    await db.from("posts").update({ media_ready: true }).in("id", waiting.map((p) => p.id));
  }

  return { newPosts: fresh.length, quality: qualityJson(quality), health: quality.health };
}

async function ingestMedia(platform: Platform, postIds: string[], items: Record<string, unknown>[]) {
  const db = createAdminClient();
  const media = normalizeItems(platform, items);
  const { data: posts } = await db.from("posts").select("id, external_id").in("id", postIds);
  for (const post of posts ?? []) {
    const m = media.find((x) => x.external_id === post.external_id);
    await db
      .from("posts")
      .update({
        media_ready: true,
        ...(m?.video_source_url ? { video_source_url: m.video_source_url } : {}),
        ...(m?.subtitles_url ? { subtitles_url: m.subtitles_url } : {}),
        ...(m?.thumbnail_source_url ? { thumbnail_source_url: m.thumbnail_source_url } : {}),
      })
      .eq("id", post.id);
  }
  return { newPosts: 0, quality: null, health: media.length ? ("ok" as const) : ("warning" as const) };
}
