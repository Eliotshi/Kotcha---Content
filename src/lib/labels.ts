// Libellés partagés entre le serveur et l'interface.

export const FORMATS = {
  face_cam: "Face caméra",
  voiceover_broll: "Voix off + B-roll",
  interview: "Interview / intervenant",
  tutorial: "Tuto / démonstration",
  trend: "Trend / son viral",
  text_only: "Texte à l'écran",
  carousel: "Carrousel / images",
  text_post: "Post texte",
  other: "Autre",
} as const;

export const HOOK_TYPES = {
  question: "Question",
  shock_stat: "Chiffre choc",
  counterintuitive: "Contre-intuitif",
  promise: "Promesse",
  story: "Histoire",
  pain_point: "Douleur / problème",
  challenge: "Défi",
  visual: "Visuel fort",
  other: "Autre",
} as const;

export const SCRIPT_KINDS = {
  talking_broll: "Vidéo parlée + B-roll",
  field_interview: "Terrain / intervenants",
} as const;

export const SCRIPT_STATUSES = {
  draft: "Brouillon",
  validated: "Validé",
  shot: "Tourné",
  published: "Publié",
} as const;

export const PROCESSING_LABEL = {
  pending: "En attente d'analyse",
  processing: "Analyse en cours",
  done: "Analysé",
  failed: "Échec de l'analyse",
  skipped: "Ignoré",
} as const;

export function label<T extends Record<string, string>>(map: T, key: string | null | undefined): string {
  if (!key) return "—";
  return (map as Record<string, string>)[key] ?? key;
}
