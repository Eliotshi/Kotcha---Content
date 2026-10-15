import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fmtRelative } from "@/lib/format";
import { label, SCRIPT_KINDS, SCRIPT_STATUSES } from "@/lib/labels";
import { Badge, buttonClass, Card, EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Scripts" };

export default async function ScriptsPage() {
  const supabase = await createClient();
  const { data: scripts } = await supabase
    .from("generated_scripts")
    .select("id, title, kind, status, updated_at, source_post_ids")
    .order("updated_at", { ascending: false });

  const columns = Object.entries(SCRIPT_STATUSES) as [keyof typeof SCRIPT_STATUSES, string][];

  return (
    <>
      <PageHeader
        title="Scripts"
        subtitle="Du brouillon généré à la vidéo publiée."
        actions={
          <Link href="/scripts/new" className={buttonClass.primary}>
            Nouveau script
          </Link>
        }
      />
      {!scripts?.length ? (
        <EmptyState title="Aucun script pour l'instant">
          Ouvre un post qui surperforme dans la Veille puis « Créer un script Kotcha inspiré », ou pars d&apos;un brief libre.
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {columns.map(([status, name]) => {
            const items = scripts.filter((s) => s.status === status);
            return (
              <section key={status} className="flex flex-col gap-2">
                <h2 className="flex items-center gap-2 px-1 text-sm font-semibold text-text">
                  {name} <span className="text-xs font-normal text-muted">{items.length}</span>
                </h2>
                {items.map((s) => (
                  <Link key={s.id} href={`/scripts/${s.id}`}>
                    <Card className="p-3 transition hover:border-text-2/40">
                      <div className="text-sm font-medium text-text">{s.title}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-2">
                        <Badge>{label(SCRIPT_KINDS, s.kind)}</Badge>
                        {s.source_post_ids.length > 0 && <span>{s.source_post_ids.length} source(s)</span>}
                        <span>{fmtRelative(s.updated_at)}</span>
                      </div>
                    </Card>
                  </Link>
                ))}
                {!items.length && <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted">Vide</div>}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
