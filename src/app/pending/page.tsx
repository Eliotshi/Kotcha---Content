import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { signOut } from "@/app/auth/actions";
import { buttonClass, Card } from "@/components/ui";

export const metadata: Metadata = { title: "Accès en attente" };

export default async function PendingPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.status === "approved") redirect("/");

  const rejected = profile.status === "rejected";
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold text-text">{rejected ? "Accès refusé" : "Compte en attente de validation"}</h1>
        <p className="mt-2 text-sm text-text-2">
          {rejected
            ? "Ton accès à Kotcha Content n'a pas été validé. Contacte l'administrateur si c'est une erreur."
            : "Ton compte est créé. Un administrateur doit valider ton accès : tu pourras ensuite utiliser l'outil sans te reconnecter. Recharge cette page une fois prévenu."}
        </p>
        <p className="mt-4 rounded-lg bg-surface-2 px-3 py-2 text-sm text-text-2">{profile.email}</p>
        <form action={signOut} className="mt-6">
          <button className={buttonClass.secondary}>Se déconnecter</button>
        </form>
      </Card>
    </main>
  );
}
