import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { GeneratedScript } from "@/lib/ai";
import { fmtDate } from "@/lib/format";
import { label, SCRIPT_KINDS, SCRIPT_STATUSES } from "@/lib/labels";
import { PLATFORM_LABEL } from "@/lib/platforms";
import { Badge, buttonClass, Card, CompetitorDot, cx, inputClass, SectionTitle } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";
import { SubmitButton } from "@/components/submit-button";
import { deleteScript, updateScriptNotes, updateScriptStatus } from "../../actions";

export const metadata: Metadata = { title: "Script" };

function asText(s: GeneratedScript) {
  const lines = [
    s.title,
    `Angle : ${s.angle}`,
    `Durée cible : ${s.duration_target_sec} s`,
    "",
    "HOOKS",
    ...s.hooks.map((h, i) => `${i + 1}. ${h}`),
    "",
    "DÉROULÉ",
    ...s.scenes.flatMap((sc) => [
      `[${sc.timing}] ${sc.visual}`,
      sc.voiceover ? `  Voix : ${sc.voiceover}` : null,
      sc.onscreen_text ? `  Texte écran : ${sc.onscreen_text}` : null,
      sc.notes ? `  Notes : ${sc.notes}` : null,
    ]),
    ...(s.interview
      ? ["", "INTERVIEW", `Profil : ${s.interview.guest_profile}`, `Lieu : ${s.interview.location}`, ...s.interview.questions.map((q) => `- ${q}`)]
      : []),
    "",
    "PLANS À TOURNER",
    ...s.shot_list.map((p) => `- ${p}`),
    "",
    "LÉGENDE",
    s.caption,
    s.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" "),
  ];
  return lines.filter((l) => l !== null).join("\n");
}

export default async function ScriptPage({ params }: PageProps<"/scripts/[id]">) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: row } = await supabase.from("generated_scripts").select("*").eq("id", id).maybeSingle();
  if (!row) notFound();
  const { data: sources } = row.source_post_ids.length
    ? await supabase.from("post_feed").select("id, competitor_name, competitor_color, hook, caption, platform").in("id", row.source_post_ids)
    : { data: [] };

  const s = row.content as unknown as GeneratedScript;
  const saveNotes = updateScriptNotes.bind(null, id);
  const remove = deleteScript.bind(null, id);

  return (
    <>
      <div className="mb-4">
        <Link href="/scripts" className="text-sm text-text-2 hover:text-text">
          ← Scripts
        </Link>
      </div>

      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-text-2">
            <Badge tone="accent">{label(SCRIPT_KINDS, row.kind)}</Badge>
            <span>{s.duration_target_sec} s</span>
            <span>· {s.platforms.map((p) => PLATFORM_LABEL[p]).join(", ")}</span>
            <span>· créé le {fmtDate(row.created_at)}</span>
          </div>
          <h1 className="mt-2 text-xl font-semibold tracking-tight text-text">{row.title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-text-2">{s.angle}</p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface p-1">
          {(Object.entries(SCRIPT_STATUSES) as [keyof typeof SCRIPT_STATUSES, string][]).map(([k, v]) => (
            <form key={k} action={updateScriptStatus.bind(null, id, k)}>
              <button className={cx("rounded-md px-2.5 py-1 text-sm", row.status === k ? "bg-accent text-accent-ink" : "text-text-2 hover:bg-surface-2")}>
                {v}
              </button>
            </form>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card className="p-4">
            <SectionTitle>Hooks à tester</SectionTitle>
            <ol className="flex flex-col gap-2 text-sm">
              {s.hooks.map((h, i) => (
                <li key={i} className="rounded-lg bg-surface-2 px-3 py-2 text-text">
                  <span className="mr-2 text-xs text-muted">{i + 1}</span>« {h} »
                </li>
              ))}
            </ol>
          </Card>

          <Card className="overflow-hidden">
            <div className="p-4 pb-0">
              <SectionTitle action={<CopyButton text={asText(s)} className={buttonClass.ghost} />}>Déroulé plan par plan</SectionTitle>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-y border-border bg-surface-2 text-xs text-text-2">
                  <tr>
                    <th className="px-4 py-2 font-medium">Temps</th>
                    <th className="px-4 py-2 font-medium">Image</th>
                    <th className="px-4 py-2 font-medium">Voix</th>
                    <th className="px-4 py-2 font-medium">Texte écran</th>
                    <th className="px-4 py-2 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {s.scenes.map((sc, i) => (
                    <tr key={i} className="border-b border-border align-top last:border-0">
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted tabular">{sc.timing}</td>
                      <td className="px-4 py-3 text-text">{sc.visual}</td>
                      <td className="px-4 py-3 text-text">{sc.voiceover || "—"}</td>
                      <td className="px-4 py-3 font-medium text-text">{sc.onscreen_text || "—"}</td>
                      <td className="px-4 py-3 text-text-2">{sc.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {s.interview && (
            <Card className="p-4">
              <SectionTitle>Intervenant</SectionTitle>
              <p className="text-sm text-text">
                {s.interview.guest_profile} <span className="text-text-2">· {s.interview.location}</span>
              </p>
              <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs text-text-2">Questions</div>
                  <ul className="flex list-disc flex-col gap-1 pl-5 text-text">
                    {s.interview.questions.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="mb-1 text-xs text-text-2">Phrases à obtenir</div>
                  <ul className="flex list-disc flex-col gap-1 pl-5 text-text">
                    {s.interview.soundbites_to_get.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </Card>
          )}

          <Card className="grid gap-4 p-4 text-sm sm:grid-cols-2">
            <div>
              <div className="mb-1 text-xs text-text-2">Plans à tourner</div>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-text">
                {s.shot_list.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-3">
              <div>
                <div className="mb-1 text-xs text-text-2">Légende</div>
                <p className="whitespace-pre-wrap text-text">{s.caption}</p>
                <p className="mt-1 text-text-2">{s.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}</p>
              </div>
              <div>
                <div className="mb-1 text-xs text-text-2">CTA</div>
                <p className="text-text">{s.cta}</p>
              </div>
              <div>
                <div className="mb-1 text-xs text-text-2">Notes de production</div>
                <p className="whitespace-pre-wrap text-text">{s.production_notes}</p>
              </div>
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card className="p-4">
            <form action={saveNotes} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-text-2">Titre</span>
                <input name="title" defaultValue={row.title} className={inputClass} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-text-2">Notes de l&apos;équipe</span>
                <textarea name="notes" rows={6} defaultValue={row.notes ?? ""} className={inputClass} placeholder="Retours, modifications, lieu de tournage…" />
              </label>
              <SubmitButton className={buttonClass.secondary} pendingLabel="Enregistrement…">
                Enregistrer
              </SubmitButton>
            </form>
          </Card>

          {(sources ?? []).length > 0 && (
            <Card className="p-4">
              <SectionTitle>Inspiré de</SectionTitle>
              <ul className="flex flex-col gap-2">
                {sources!.map((p) => (
                  <li key={p.id}>
                    <Link href={`/posts/${p.id}`} className="block rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                      <span className="inline-flex items-center gap-1.5 text-xs text-text-2">
                        <CompetitorDot color={p.competitor_color} />
                        {p.competitor_name} · {p.platform ? PLATFORM_LABEL[p.platform] : ""}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-text">{p.hook ?? p.caption}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {row.brief && (
            <Card className="p-4 text-sm">
              <div className="mb-1 text-xs text-text-2">Brief</div>
              <p className="whitespace-pre-wrap text-text">{row.brief}</p>
            </Card>
          )}

          <form action={remove}>
            <button className={`${buttonClass.danger} w-full`}>Supprimer le script</button>
          </form>
        </div>
      </div>
    </>
  );
}
