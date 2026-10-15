import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import type { Json } from "@/lib/database.types";

export type AlertLevel = "info" | "warning" | "critical";

/**
 * Enregistre une alerte (dédupliquée tant qu'elle n'est pas résolue) et la pousse
 * vers le webhook d'équipe s'il est configuré. Ne lève jamais : une alerte ne doit pas casser un traitement.
 */
export async function raiseAlert(alert: { level: AlertLevel; kind: string; message: string; dedupeKey?: string; ref?: Json }) {
  try {
    const db = createAdminClient();
    if (alert.dedupeKey) {
      const { data: open } = await db
        .from("alerts")
        .select("id")
        .eq("dedupe_key", alert.dedupeKey)
        .is("resolved_at", null)
        .maybeSingle();
      if (open) return;
    }
    const { error } = await db.from("alerts").insert({
      level: alert.level,
      kind: alert.kind,
      message: alert.message,
      dedupe_key: alert.dedupeKey ?? null,
      ref: alert.ref ?? null,
    });
    if (error) return; // course avec une autre invocation sur la même dedupe_key

    const hook = env.alertWebhookUrl();
    if (hook && alert.level !== "info") {
      const icon = alert.level === "critical" ? "🔴" : "🟠";
      await fetch(hook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `${icon} Kotcha Content — ${alert.message}`, content: `${icon} Kotcha Content — ${alert.message}` }),
        signal: AbortSignal.timeout(5_000),
      }).catch(() => undefined);
    }
  } catch {
    // ignoré volontairement
  }
}

export async function resolveAlerts(dedupeKey: string) {
  const db = createAdminClient();
  await db.from("alerts").update({ resolved_at: new Date().toISOString() }).eq("dedupe_key", dedupeKey).is("resolved_at", null);
}
