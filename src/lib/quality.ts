import { EXPECTED_KEYS, type NormalizedPost, type Platform } from "@/lib/platforms";
import type { Json } from "@/lib/database.types";

export type QualityReport = {
  health: "ok" | "warning" | "error";
  items: number;
  normalized: number;
  issues: string[];
  metrics: Record<string, number>;
};

function pct(part: number, total: number) {
  return total ? Math.round((part / total) * 100) : 0;
}

/**
 * Contrôle qualité d'une collecte : volume, champs vides, clés disparues.
 * Les scrapers changent de format sans prévenir : sans ce contrôle, les scores deviendraient faux en silence.
 */
export function assessQuality(platform: Platform, items: Record<string, unknown>[], posts: NormalizedPost[]): QualityReport {
  const issues: string[] = [];
  const videos = posts.filter((p) => p.media_type === "video");
  const metrics = {
    items: items.length,
    normalized: posts.length,
    null_published_at_pct: pct(posts.filter((p) => !p.published_at).length, posts.length),
    null_likes_pct: pct(posts.filter((p) => p.likes === null || p.likes === undefined).length, posts.length),
    null_video_views_pct: platform === "linkedin" ? 0 : pct(videos.filter((p) => p.views === null || p.views === undefined).length, videos.length),
  };

  let health: QualityReport["health"] = "ok";
  if (items.length === 0) {
    health = "error";
    issues.push("aucun résultat (compte introuvable, privé, ou actor en panne)");
  } else if (posts.length === 0) {
    health = "error";
    issues.push(`${items.length} résultats mais aucun post exploitable : format de l'actor probablement changé`);
  }

  const keys = new Set(items.flatMap((i) => Object.keys(i)));
  const missing = items.length ? EXPECTED_KEYS[platform].filter((group) => !group.some((k) => keys.has(k))).map((g) => g.join("|")) : [];
  if (missing.length) {
    health = health === "error" ? "error" : "warning";
    issues.push(`champs attendus absents : ${missing.join(", ")}`);
  }
  for (const [label, value] of [
    ["date de publication", metrics.null_published_at_pct],
    ["likes", metrics.null_likes_pct],
    ["vues des vidéos", metrics.null_video_views_pct],
  ] as const) {
    if (value > 30) {
      health = health === "error" ? "error" : "warning";
      issues.push(`${label} manquant(e)s sur ${value} % des posts`);
    }
  }

  return { health, items: items.length, normalized: posts.length, issues, metrics };
}

export function qualityJson(report: QualityReport): Json {
  return { issues: report.issues, ...report.metrics };
}
