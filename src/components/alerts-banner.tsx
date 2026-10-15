import Link from "next/link";
import { fmtRelative } from "@/lib/format";

type Alert = { id: string; level: string; message: string; created_at: string };

/** Problèmes en cours (collecte en panne, qualité dégradée, budget) : visibles au lieu de silencieux. */
export function AlertsBanner({ alerts }: { alerts: Alert[] }) {
  if (!alerts.length) return null;
  return (
    <div className="mb-5 flex flex-col gap-2" role="status">
      {alerts.map((a) => (
        <div
          key={a.id}
          className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${a.level === "critical" ? "bg-critical-soft text-critical" : "bg-warning-soft text-warning"}`}
        >
          <span aria-hidden>{a.level === "critical" ? "⛔" : "⚠️"}</span>
          <span className="flex-1">
            {a.message} <span className="opacity-70">· {fmtRelative(a.created_at)}</span>
          </span>
        </div>
      ))}
      <Link href="/admin#alertes" className="self-end text-xs text-text-2 hover:text-text">
        Toutes les alertes →
      </Link>
    </div>
  );
}
