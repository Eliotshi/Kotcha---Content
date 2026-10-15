const compact = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("fr-FR");

export function fmtNumber(n: number | null | undefined, options?: { full?: boolean }): string {
  if (n === null || n === undefined) return "—";
  return options?.full ? full.format(n) : compact.format(n);
}

export function fmtPercent(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}

export function fmtScore(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}×`;
}

export function fmtDuration(sec: number | null | undefined): string | null {
  if (!sec) return null;
  const s = Math.round(sec);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")}`;
}

export function fmtDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: "Europe/Paris",
  });
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "jamais";
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  return `il y a ${days} j`;
}

export function storageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media/${path}`;
}

/** Date ISO d'il y a `days` jours (pour les filtres de période côté serveur). */
export function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}
