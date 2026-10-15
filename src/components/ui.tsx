import type { ComponentProps, ReactNode } from "react";

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export const buttonClass = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-50 transition",
  secondary:
    "inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-medium text-text hover:bg-surface-2 disabled:opacity-50 transition",
  ghost:
    "inline-flex items-center justify-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium text-text-2 hover:bg-surface-2 hover:text-text disabled:opacity-50 transition",
  danger:
    "inline-flex items-center justify-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium text-critical hover:bg-critical-soft disabled:opacity-50 transition",
};

export const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/40";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("rounded-xl border border-border bg-surface", className)} {...props} />;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold text-text">{children}</h2>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-text">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-text-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const badgeTones = {
  neutral: "bg-surface-2 text-text-2",
  accent: "bg-accent-soft text-accent",
  good: "bg-good-soft text-good",
  warning: "bg-warning-soft text-warning",
  critical: "bg-critical-soft text-critical",
};

export function Badge({ tone = "neutral", children, className }: { tone?: keyof typeof badgeTones; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium", badgeTones[tone], className)}>
      {children}
    </span>
  );
}

/** Pastille d'identité d'un concurrent : la couleur porte l'identité, le texte reste à l'encre. */
export function CompetitorDot({ color }: { color: string | null | undefined }) {
  return <span aria-hidden className="inline-block size-2 shrink-0 rounded-full" style={{ backgroundColor: color ?? "var(--muted)" }} />;
}

export function StatTile({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-text-2">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-text">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </Card>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Card className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="text-sm font-medium text-text">{title}</div>
      {children && <div className="max-w-md text-sm text-text-2">{children}</div>}
    </Card>
  );
}

/**
 * Score à âge égal : icône + libellé, jamais la couleur seule.
 * « provisoire » avant 48 h (le post est encore en phase de lancement), « fiabilité faible » si peu de posts comparables.
 */
export function OutlierBadge({
  score,
  confidence,
  ageHours,
  showMissing = false,
}: {
  score: number | null | undefined;
  confidence?: string | null;
  ageHours?: number | null;
  showMissing?: boolean;
}) {
  if (score === null || score === undefined) {
    return showMissing ? <Badge tone="neutral">Score : historique insuffisant</Badge> : null;
  }
  const value = `${score.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}×`;
  const qualifiers = [
    ageHours !== null && ageHours !== undefined && ageHours < 48 ? `provisoire (${Math.round(ageHours)} h)` : null,
    confidence === "low" ? "fiabilité faible" : null,
  ].filter(Boolean);
  const suffix = qualifiers.length ? ` · ${qualifiers.join(" · ")}` : "";
  if (score >= 2) return <Badge tone="good">▲ {value} à âge égal{suffix}</Badge>;
  if (score < 0.6) return <Badge tone="neutral">▼ {value}{suffix}</Badge>;
  return <Badge tone="neutral">{value}{suffix}</Badge>;
}

/** Catégories exclues de la référence de score (leur portée ne dépend pas que du contenu). */
export function PostFlags({ pinned, paid, collab }: { pinned?: boolean | null; paid?: boolean | null; collab?: boolean | null }) {
  return (
    <>
      {pinned && <Badge tone="accent">📌 Épinglé</Badge>}
      {paid && <Badge tone="warning">Partenariat / sponsorisé</Badge>}
      {collab && <Badge tone="warning">Collab</Badge>}
    </>
  );
}
