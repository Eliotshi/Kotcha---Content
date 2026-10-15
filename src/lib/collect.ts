import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { getDatasetItems, getRun, startActorRun } from "@/lib/apify";
import { buildActorInput, normalizeItems } from "@/lib/platforms";

export type CollectResult = { started: number; errors: string[] };

/**
 * Lance un run Apify par compte actif (un run par compte : le rattachement des posts
 * au bon compte est trivial, et un compte en échec ne bloque pas les autres).
 */
export async function startCollection(options: { trigger: "cron" | "manual"; accountIds?: string[] }): Promise<CollectResult> {
  const db = createAdminClient();
  let query = db.from("social_accounts").select("id, platform, handle").eq("active", true);
  if (options.accountIds?.length) query = query.in("id", options.accountIds);
  const { data: accounts, error } = await query;
  if (error) throw error;

  const webhookUrl = `${env.appUrl()}/api/webhooks/apify?secret=${encodeURIComponent(env.jobsSecret())}`;
  const limit = env.postsPerAccount();
  const result: CollectResult = { started: 0, errors: [] };

  for (const account of accounts ?? []) {
    const actorId = env.actor(account.platform);
    try {
      const run = await startActorRun(actorId, buildActorInput(account.platform, account.handle, limit), webhookUrl);
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
    }
  }
  return result;
}

/**
 * Importe les résultats d'un run Apify terminé : upsert des posts, relevé des métriques,
 * et mise en file d'attente des nouveaux posts pour la transcription / l'analyse.
 * Idempotent : peut être rappelé sans créer de doublons de posts.
 */
export async function ingestRun(apifyRunId: string): Promise<{ items: number; newPosts: number }> {
  const db = createAdminClient();
  const { data: scrapeRun } = await db.from("scrape_runs").select("*").eq("apify_run_id", apifyRunId).maybeSingle();
  if (!scrapeRun) throw new Error(`Run Apify inconnu : ${apifyRunId}`);

  // On relit le run chez Apify plutôt que de faire confiance au contenu du webhook.
  const run = await getRun(apifyRunId);
  if (run.status !== "SUCCEEDED") {
    await db
      .from("scrape_runs")
      .update({ status: run.status, cost_usd: run.usageTotalUsd ?? null, finished_at: run.finishedAt ?? new Date().toISOString() })
      .eq("id", scrapeRun.id);
    return { items: 0, newPosts: 0 };
  }

  const accountId = scrapeRun.account_ids[0];
  const items = await getDatasetItems(run.defaultDatasetId);
  const posts = normalizeItems(scrapeRun.platform, items);
  const now = new Date().toISOString();

  const externalIds = posts.map((p) => p.external_id);
  const { data: existing } = externalIds.length
    ? await db.from("posts").select("external_id").eq("platform", scrapeRun.platform).in("external_id", externalIds)
    : { data: [] };
  const known = new Set((existing ?? []).map((p) => p.external_id));

  const followers = posts.find((p) => p.followers)?.followers ?? null;

  const rows = posts.map(({ followers: postFollowers, ...p }) => ({
    ...p,
    account_id: accountId,
    followers_at_capture: postFollowers ?? followers,
    metrics_updated_at: now,
  }));

  let newPosts = 0;
  if (rows.length) {
    // Les nouveaux posts entrent en file "pending" ; les existants gardent leur statut de traitement.
    const fresh = rows.filter((r) => !known.has(r.external_id)).map((r) => ({ ...r, processing_status: "pending" as const }));
    const refreshed = rows.filter((r) => known.has(r.external_id));
    newPosts = fresh.length;

    const upserted: { id: string; views: number | null; likes: number | null; comments: number | null; shares: number | null; saves: number | null; followers_at_capture: number | null }[] = [];
    for (const batch of [fresh, refreshed]) {
      if (!batch.length) continue;
      const { data, error } = await db
        .from("posts")
        .upsert(batch, { onConflict: "platform,external_id" })
        .select("id, views, likes, comments, shares, saves, followers_at_capture");
      if (error) throw error;
      upserted.push(...(data ?? []));
    }

    await db.from("post_metrics").insert(
      upserted.map((p) => ({
        post_id: p.id,
        captured_at: now,
        views: p.views,
        likes: p.likes,
        comments: p.comments,
        shares: p.shares,
        saves: p.saves,
        followers: p.followers_at_capture,
      })),
    );
  }

  await db
    .from("social_accounts")
    .update({ last_scraped_at: now, ...(followers ? { followers } : {}) })
    .eq("id", accountId);

  await db
    .from("scrape_runs")
    .update({
      status: run.status,
      items_count: items.length,
      new_posts: newPosts,
      cost_usd: run.usageTotalUsd ?? null,
      finished_at: run.finishedAt ?? now,
    })
    .eq("id", scrapeRun.id);

  return { items: items.length, newPosts };
}
