"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireApproved } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertDailyLimit, getSettings, LimitError, recordUsage, withinBudget } from "@/lib/budget";
import { startCollection } from "@/lib/collect";
import { triggerProcessing } from "@/lib/process";
import { generateScript, type ScriptSource } from "@/lib/ai";
import { normalizeHandle, PLATFORMS, type Platform } from "@/lib/platforms";
import type { Enums, Json } from "@/lib/database.types";
import { FORMATS, HOOK_TYPES, SCRIPT_KINDS, SCRIPT_STATUSES } from "@/lib/labels";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

function failure(e: unknown): ActionResult {
  if (e instanceof LimitError) return { ok: false, error: e.message };
  return { ok: false, error: "Une erreur est survenue. Réessaie dans un instant." };
}

/** Seuls les liens http(s) sont acceptés (pas de javascript:, data:, etc.). */
function safeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

const CATEGORICAL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"];

// ───────── Concurrents ─────────

export async function addCompetitor(formData: FormData) {
  await requireApproved();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const supabase = await createClient();
  const { count } = await supabase.from("competitors").select("id", { count: "exact", head: true });
  await supabase.from("competitors").insert({
    name,
    website: safeUrl(String(formData.get("website") ?? "").trim()),
    color: CATEGORICAL[(count ?? 0) % CATEGORICAL.length],
  });
  revalidatePath("/competitors");
}

export async function deleteCompetitor(id: string) {
  await requireAdmin();
  const supabase = await createClient();
  await supabase.from("competitors").delete().eq("id", id);
  revalidatePath("/competitors");
}

export async function addAccount(formData: FormData) {
  await requireApproved();
  const competitorId = String(formData.get("competitor_id") ?? "");
  const platform = String(formData.get("platform") ?? "") as Platform;
  const rawHandle = String(formData.get("handle") ?? "").trim();
  if (!competitorId || !rawHandle || !PLATFORMS.includes(platform)) return;
  const supabase = await createClient();
  await supabase.from("social_accounts").insert({
    competitor_id: competitorId,
    platform,
    handle: normalizeHandle(platform, rawHandle),
  });
  revalidatePath("/competitors");
}

export async function setAccountActive(id: string, active: boolean) {
  await requireApproved();
  const supabase = await createClient();
  await supabase.from("social_accounts").update({ active }).eq("id", id);
  revalidatePath("/competitors");
}

export async function deleteAccount(id: string) {
  await requireAdmin();
  const supabase = await createClient();
  await supabase.from("social_accounts").delete().eq("id", id);
  revalidatePath("/competitors");
}

export async function runCollectionNow(accountId?: string): Promise<ActionResult> {
  const profile = await requireApproved();
  try {
    const settings = await getSettings();
    await assertDailyLimit("manual_collection", settings.daily_limit_manual_collections, null, "collectes manuelles");
    const result = await startCollection({ trigger: "manual", accountIds: accountId ? [accountId] : undefined });
    if (result.skipped) return { ok: false, error: result.skipped };
    await recordUsage({ kind: "manual_collection", userId: profile.id, meta: { accounts: result.started } });
    revalidatePath("/competitors");
    return { ok: true, message: `${result.started} collecte(s) lancée(s).` };
  } catch (e) {
    return failure(e);
  }
}

// ───────── Posts ─────────

export async function reprocessPost(postId: string): Promise<ActionResult> {
  const profile = await requireApproved();
  try {
    const settings = await getSettings();
    await assertDailyLimit("reprocess", settings.daily_limit_reprocess_per_user, profile.id, "ré-analyses");
    if (!(await withinBudget("ai"))) return { ok: false, error: "Plafond mensuel IA atteint." };
    // Écriture via le serveur (les posts sont en lecture seule côté API), limitée aux champs de file d'attente.
    await createAdminClient()
      .from("posts")
      .update({ processing_status: "pending", processing_attempts: 0, processing_error: null, media_refresh_count: 0 })
      .eq("id", postId);
    await recordUsage({ kind: "reprocess", userId: profile.id, refId: postId });
    await triggerProcessing();
    revalidatePath(`/posts/${postId}`);
    return { ok: true, message: "Analyse relancée." };
  } catch (e) {
    return failure(e);
  }
}

/** Correction manuelle du format et du type de hook (verrouillée contre les ré-analyses). */
export async function correctAnalysis(postId: string, formData: FormData) {
  const profile = await requireApproved();
  const format = String(formData.get("format") ?? "");
  const hookType = String(formData.get("hook_type") ?? "");
  if (!(format in FORMATS) || !(hookType in HOOK_TYPES)) return;
  await createAdminClient()
    .from("analyses")
    .update({ format, hook_type: hookType, format_locked: true, edited_by: profile.id, edited_at: new Date().toISOString() })
    .eq("post_id", postId);
  revalidatePath(`/posts/${postId}`);
  revalidatePath("/");
}

export async function processQueueNow() {
  await requireApproved();
  if (!(await withinBudget("ai"))) return;
  await triggerProcessing();
  revalidatePath("/");
}

// ───────── Scripts ─────────

export async function createScript(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const profile = await requireApproved();
  let scriptId: string;
  try {
    scriptId = await generateAndSaveScript(profile.id, formData);
  } catch (e) {
    return failure(e);
  }
  revalidatePath("/scripts");
  redirect(`/scripts/${scriptId}`);
}

async function generateAndSaveScript(userId: string, formData: FormData): Promise<string> {
  const settings = await getSettings();
  await assertDailyLimit("ai_script", settings.daily_limit_scripts_per_user, userId, "scripts générés");
  if (!(await withinBudget("ai"))) throw new LimitError("Plafond mensuel IA atteint : génération suspendue.");
  const kind = String(formData.get("kind") ?? "talking_broll") as keyof typeof SCRIPT_KINDS;
  if (!(kind in SCRIPT_KINDS)) throw new Error("Format inconnu");
  const brief = String(formData.get("brief") ?? "");
  const postIds = formData.getAll("post_ids").map(String).filter(Boolean).slice(0, 5);

  const supabase = await createClient();
  const [{ data: feed }, { data: analyses }, { data: brandRow }] = await Promise.all([
    postIds.length
      ? supabase.from("post_feed").select("id, competitor_name, platform, outlier_score, views, caption").in("id", postIds)
      : Promise.resolve({ data: [] as never[] }),
    postIds.length ? supabase.from("analyses").select("*").in("post_id", postIds) : Promise.resolve({ data: [] as never[] }),
    supabase.from("app_settings").select("brand_voice").eq("id", 1).maybeSingle(),
  ]);
  const brandSettings = brandRow;

  const sources: ScriptSource[] = (feed ?? []).map((p) => {
    const a = (analyses ?? []).find((x) => x.post_id === p.id);
    return {
      competitor: p.competitor_name ?? "?",
      platform: p.platform ?? "?",
      outlierScore: p.outlier_score,
      views: p.views,
      caption: p.caption,
      analysis: a
        ? {
            format: a.format as never,
            hook: a.hook ?? undefined,
            hook_type: a.hook_type as never,
            structure: a.structure as never,
            theme: a.theme ?? undefined,
            cta: a.cta ?? undefined,
            tone: a.tone ?? undefined,
            why_it_works: a.why_it_works ?? undefined,
            script_reconstructed: a.script_reconstructed ?? undefined,
          }
        : null,
    };
  });

  const { script, model, costUsd } = await generateScript({ kind, brief, brandVoice: brandSettings?.brand_voice ?? "", sources });

  const { data: inserted, error } = await supabase
    .from("generated_scripts")
    .insert({
      title: script.title,
      kind,
      brief: brief || null,
      source_post_ids: postIds,
      content: script as unknown as Json,
      model,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) throw error;
  await recordUsage({ kind: "ai_script", costUsd, userId, refId: inserted.id, meta: { model } });
  return inserted.id;
}

export async function updateScriptStatus(id: string, status: Enums<"script_status">) {
  await requireApproved();
  if (!(status in SCRIPT_STATUSES)) return;
  const supabase = await createClient();
  await supabase.from("generated_scripts").update({ status }).eq("id", id);
  revalidatePath("/scripts");
  revalidatePath(`/scripts/${id}`);
}

export async function updateScriptNotes(id: string, formData: FormData) {
  await requireApproved();
  const supabase = await createClient();
  await supabase
    .from("generated_scripts")
    .update({ notes: String(formData.get("notes") ?? ""), title: String(formData.get("title") ?? "").trim() || undefined })
    .eq("id", id);
  revalidatePath(`/scripts/${id}`);
  revalidatePath("/scripts");
}

export async function deleteScript(id: string) {
  await requireApproved();
  const supabase = await createClient();
  await supabase.from("generated_scripts").delete().eq("id", id);
  revalidatePath("/scripts");
  redirect("/scripts");
}

// ───────── Administration ─────────

export async function setUserStatus(userId: string, status: Enums<"profile_status">) {
  const admin = await requireAdmin();
  if (userId === admin.id) return; // on ne se retire pas soi-même l'accès
  const supabase = await createClient();
  await supabase
    .from("profiles")
    .update({
      status,
      approved_by: status === "approved" ? admin.id : null,
      approved_at: status === "approved" ? new Date().toISOString() : null,
    })
    .eq("id", userId);
  revalidatePath("/admin");
}

export async function setUserRole(userId: string, role: Enums<"profile_role">) {
  const admin = await requireAdmin();
  if (userId === admin.id) return;
  const supabase = await createClient();
  await supabase.from("profiles").update({ role }).eq("id", userId);
  revalidatePath("/admin");
}

export async function revokeUserSessions(userId: string) {
  await requireAdmin();
  const supabase = await createClient();
  await supabase.rpc("admin_revoke_sessions", { target: userId });
  revalidatePath("/admin");
}

export async function resolveAlert(alertId: string) {
  const admin = await requireAdmin();
  const supabase = await createClient();
  await supabase.from("alerts").update({ resolved_at: new Date().toISOString(), resolved_by: admin.id }).eq("id", alertId);
  revalidatePath("/admin");
  revalidatePath("/");
}

export async function saveSettings(formData: FormData) {
  const admin = await requireAdmin();
  const num = (key: string, min: number, max: number) => {
    const n = Number(formData.get(key));
    return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : undefined;
  };
  const domains = String(formData.get("allowed_email_domains") ?? "")
    .split(/[\s,;]+/)
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d));
  const supabase = await createClient();
  await supabase
    .from("app_settings")
    .update({
      allowed_email_domains: domains,
      monthly_budget_apify_usd: num("monthly_budget_apify_usd", 0, 10_000),
      monthly_budget_ai_usd: num("monthly_budget_ai_usd", 0, 10_000),
      daily_limit_manual_collections: num("daily_limit_manual_collections", 0, 100),
      daily_limit_scripts_per_user: num("daily_limit_scripts_per_user", 0, 500),
      daily_limit_reprocess_per_user: num("daily_limit_reprocess_per_user", 0, 500),
      retention_months: num("retention_months", 1, 60),
      updated_by: admin.id,
    })
    .eq("id", 1);
  revalidatePath("/admin");
}

export async function saveBrandVoice(formData: FormData) {
  const admin = await requireAdmin();
  const supabase = await createClient();
  await supabase
    .from("app_settings")
    .update({ brand_voice: String(formData.get("brand_voice") ?? ""), updated_by: admin.id })
    .eq("id", 1);
  revalidatePath("/admin");
}
