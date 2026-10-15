import { requireApproved } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/auth/actions";
import { BottomNav, SideNav } from "@/components/nav";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const profile = await requireApproved();
  const isAdmin = profile.role === "admin";

  let pendingUsers = 0;
  if (isAdmin) {
    const supabase = await createClient();
    const { count } = await supabase.from("profiles").select("id", { count: "exact", head: true }).eq("status", "pending");
    pendingUsers = count ?? 0;
  }

  const items = [
    { href: "/", label: "Veille" },
    { href: "/scripts", label: "Scripts" },
    { href: "/competitors", label: "Concurrents" },
    ...(isAdmin ? [{ href: "/admin", label: "Admin", badge: pendingUsers }] : []),
  ];

  return (
    <div className="min-h-dvh md:flex">
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-border bg-surface px-3 py-5 md:flex">
        <div className="mb-6 flex items-center gap-2 px-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" className="size-7" />
          <div className="text-sm font-semibold leading-tight text-text">
            Kotcha
            <div className="text-xs font-normal text-text-2">Content</div>
          </div>
        </div>
        <SideNav items={items} />
        <div className="mt-auto border-t border-border px-3 pt-4">
          <div className="truncate text-xs text-text-2" title={profile.email}>
            {profile.email}
          </div>
          <form action={signOut}>
            <button className="mt-1 text-xs text-muted hover:text-text">Se déconnecter</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 pb-24 pt-6 md:px-8 md:pb-10 md:pt-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
      <BottomNav items={items} />
    </div>
  );
}
