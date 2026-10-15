"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireApproved } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { startCollection } from "@/lib/collect";
import { triggerProcessing } from "@/lib/process";
import { generateScript, type ScriptSource } from "@/lib/ai";
import { normalizeHandle, PLATFORMS, type Platform } from "@/lib/platforms";
import type { Enums, Json } from "@/lib/database.types";
import { SCRIPT_KINDS, SCRIPT_STATUSES } from "@/lib/labels";

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
    website: String(formData.get("website") ?? "").trim() || null,
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

export async function runCollectionNow(accountId?: string) {
  await requireApproved();
  const result = await startCollection({ trigger: "manual", accountIds: accountId ? [accountId] : undefined });
  revalidatePath("/competitors");
  return result;
}

// ───────── Posts ─────────

export async function reprocessPost(postId: string) {
  await requireApproved();
  const supabase = await createClient();
  await supabase.from("posts").update({ processing_status: "pending", processing_attempts: 0, processing_error: null }).eq("id", postId);
  await triggerProcessing();
  revalidatePath(`/posts/${postId}`);
}

export async function processQueueNow() {
  await requireApproved();
  await triggerProcessing();
  revalidatePath("/");
}

// ───────── Scripts ─────────

export async function createScript(formData: FormData) {
  const profile = await requireApproved();
  const kind = String(formData.get("kind") ?? "talking_broll") as keyof typeof SCRIPT_KINDS;
  if (!(kind in SCRIPT_KINDS)) throw new Error("Format inconnu");
  const brief = String(formData.get("brief") ?? "");
  const postIds = formData.getAll("post_ids").map(String).filter(Boolean).slice(0, 5);

  const supabase = await createClient();
  const [{ data: feed }, { data: analyses }, { data: settings }] = await Promise.all([
    postIds.length
      ? supabase.from("post_feed").select("id, competitor_name, platform, outlier_score, views, caption").in("id", postIds)
      : Promise.resolve({ data: [] as never[] }),
    postIds.length ? supabase.from("analyses").select("*").in("post_id", postIds) : Promise.resolve({ data: [] as never[] }),
    supabase.from("app_settings").select("brand_voice").eq("id", 1).maybeSingle(),
  ]);

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

  const { script, model } = await generateScript({ kind, brief, brandVoice: settings?.brand_voice ?? "", sources });

  const { data: inserted, error } = await supabase
    .from("generated_scripts")
    .insert({
      title: script.title,
      kind,
      brief: brief || null,
      source_post_ids: postIds,
      content: script as unknown as Json,
      model,
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (error) throw error;
  revalidatePath("/scripts");
  redirect(`/scripts/${inserted.id}`);
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

export async function saveBrandVoice(formData: FormData) {
  const admin = await requireAdmin();
  const supabase = await createClient();
  await supabase
    .from("app_settings")
    .update({ brand_voice: String(formData.get("brand_voice") ?? ""), updated_by: admin.id })
    .eq("id", 1);
  revalidatePath("/admin");
}
