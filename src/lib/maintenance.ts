import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/budget";
import { raiseAlert, resolveAlerts } from "@/lib/alerts";
import { PLATFORM_LABEL } from "@/lib/platforms";

/**
 * Rétention RGPD : supprime les posts publiés il y a plus de `retention_months` mois
 * (relevés, transcriptions et analyses suivent par cascade) ainsi que leurs miniatures.
 */
export async function purgeExpiredData(): Promise<{ posts: number }> {
  const db = createAdminClient();
  const { retention_months } = await getSettings();
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - retention_months);

  let total = 0;
  for (;;) {
    const { data: batch } = await db
      .from("posts")
      .select("id, thumbnail_path")
      .lt("published_at", cutoff.toISOString())
      .limit(200);
    if (!batch?.length) break;
    const paths = batch.map((p) => p.thumbnail_path).filter((p): p is string => Boolean(p));
    if (paths.length) await db.storage.from("media").remove(paths);
    await db.from("posts").delete().in("id", batch.map((p) => p.id));
    total += batch.length;
    if (batch.length < 200) break;
  }

  // Les alertes résolues depuis plus de 6 mois n'ont plus d'utilité.
  const sixMonths = new Date(Date.now() - 183 * 86_400_000).toISOString();
  await db.from("alerts").delete().lt("resolved_at", sixMonths);
  return { posts: total };
}

/** Détecte ce qui s'arrête sans bruit : comptes plus collectés, file d'analyse bloquée. */
export async function runHealthChecks(): Promise<void> {
  const db = createAdminClient();
  const staleBefore = Date.now() - 72 * 3_600_000;

  const { data: accounts } = await db.from("social_accounts").select("id, platform, handle, last_scraped_at, created_at").eq("active", true);
  for (const a of accounts ?? []) {
    const last = a.last_scraped_at ? new Date(a.last_scraped_at).getTime() : new Date(a.created_at).getTime();
    const key = `stale_account:${a.id}`;
    if (last < staleBefore) {
      await raiseAlert({
        level: "warning",
        kind: "stale_account",
        message: `${PLATFORM_LABEL[a.platform]} @${a.handle} n'a pas été collecté avec succès depuis plus de 3 jours.`,
        dedupeKey: key,
      });
    } else {
      await resolveAlerts(key);
    }
  }

  const dayAgo = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const { count: stuck } = await db
    .from("posts")
    .select("id", { count: "exact", head: true })
    .eq("processing_status", "pending")
    .lt("created_at", dayAgo);
  if ((stuck ?? 0) > 0) {
    await raiseAlert({
      level: "warning",
      kind: "queue_stuck",
      message: `${stuck} post(s) attendent leur analyse depuis plus de 24 h (budget IA atteint, clé manquante ou traitement bloqué).`,
      dedupeKey: `queue_stuck:${new Date().toISOString().slice(0, 10)}`,
    });
  }

  // Posts restés « en cours » après leur dernière tentative (crash) : on les passe en échec, visibles et relançables.
  await db
    .from("posts")
    .update({ processing_status: "failed", processing_error: "Traitement interrompu" })
    .eq("processing_status", "processing")
    .gte("processing_attempts", 3)
    .lt("updated_at", new Date(Date.now() - 3_600_000).toISOString());
}
