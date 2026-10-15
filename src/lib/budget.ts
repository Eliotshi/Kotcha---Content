import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { raiseAlert } from "@/lib/alerts";
import type { Json, Tables } from "@/lib/database.types";

export type BudgetKind = "apify" | "ai";
export type UsageKind = "ai_analysis" | "ai_script" | "transcription" | "manual_collection" | "reprocess";

const AI_KINDS: UsageKind[] = ["ai_analysis", "ai_script", "transcription"];

export class LimitError extends Error {}

export async function getSettings(): Promise<Tables<"app_settings">> {
  const db = createAdminClient();
  const { data, error } = await db.from("app_settings").select("*").eq("id", 1).single();
  if (error) throw error;
  return data;
}

function monthStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export async function spentThisMonth(): Promise<Record<BudgetKind, number>> {
  const db = createAdminClient();
  const since = monthStart();
  const [{ data: runs }, { data: usage }] = await Promise.all([
    db.from("scrape_runs").select("cost_usd").gte("started_at", since),
    db.from("usage_events").select("cost_usd").in("kind", AI_KINDS).gte("created_at", since),
  ]);
  return {
    apify: (runs ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0),
    ai: (usage ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0),
  };
}

/**
 * Vérifie le plafond mensuel. Alerte à 80 % et à 100 %.
 * Renvoie false quand le plafond est atteint : l'appelant doit alors s'abstenir de dépenser.
 */
export async function withinBudget(kind: BudgetKind): Promise<boolean> {
  const [settings, spent] = await Promise.all([getSettings(), spentThisMonth()]);
  const cap = Number(kind === "apify" ? settings.monthly_budget_apify_usd : settings.monthly_budget_ai_usd);
  const used = spent[kind];
  const label = kind === "apify" ? "Apify" : "IA (Claude + transcription)";
  const month = new Date().toISOString().slice(0, 7);
  if (used >= cap) {
    await raiseAlert({
      level: "critical",
      kind: "budget",
      message: `Plafond mensuel ${label} atteint (${used.toFixed(2)} $ / ${cap.toFixed(2)} $) : les traitements correspondants sont suspendus jusqu'au mois prochain ou à la hausse du plafond.`,
      dedupeKey: `budget:${kind}:${month}:100`,
    });
    return false;
  }
  if (used >= cap * 0.8) {
    await raiseAlert({
      level: "warning",
      kind: "budget",
      message: `${label} : 80 % du plafond mensuel consommés (${used.toFixed(2)} $ / ${cap.toFixed(2)} $).`,
      dedupeKey: `budget:${kind}:${month}:80`,
    });
  }
  return true;
}

export async function recordUsage(event: { kind: UsageKind; costUsd?: number; userId?: string | null; refId?: string | null; meta?: Json }) {
  const db = createAdminClient();
  await db.from("usage_events").insert({
    kind: event.kind,
    cost_usd: Number((event.costUsd ?? 0).toFixed(4)),
    user_id: event.userId ?? null,
    ref_id: event.refId ?? null,
    meta: event.meta ?? null,
  });
}

/** Limite d'usage sur 24 h glissantes, par utilisateur (ou pour toute l'équipe si userId est null). */
export async function assertDailyLimit(kind: UsageKind, limit: number, userId: string | null, label: string) {
  const db = createAdminClient();
  let query = db
    .from("usage_events")
    .select("id", { count: "exact", head: true })
    .eq("kind", kind)
    .gte("created_at", new Date(Date.now() - 86_400_000).toISOString());
  if (userId) query = query.eq("user_id", userId);
  const { count } = await query;
  if ((count ?? 0) >= limit) {
    throw new LimitError(`Limite atteinte : ${limit} ${label} par 24 h${userId ? "" : " pour l'équipe"}. Réessaie plus tard ou demande à un admin de relever la limite.`);
  }
}

// Tarifs publics par million de tokens (entrée / sortie), à mettre à jour si les prix changent.
const PRICES: Record<string, [number, number]> = {
  "claude-fable-5-1": [10, 50],
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};

export function aiCostUsd(
  model: string,
  usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null },
) {
  const [inPrice, outPrice] = PRICES[model] ?? PRICES[Object.keys(PRICES).find((k) => model.startsWith(k)) ?? ""] ?? [10, 50];
  const input =
    usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) * 1.25 + (usage.cache_read_input_tokens ?? 0) * 0.1;
  return (input * inPrice + usage.output_tokens * outPrice) / 1_000_000;
}
