import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";

const PUBLIC_PATHS = ["/login", "/api/"];
const LAST_SEEN_COOKIE = "kc_last_seen";
const INACTIVITY_DAYS = Number(process.env.INACTIVITY_DAYS || 30);

/**
 * Rafraîchit la session Supabase à chaque requête (cookies longue durée :
 * l'utilisateur reste connecté sur son téléphone / ordinateur) et redirige
 * vers /login quand il n'y a pas de session.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // Ne rien intercaler entre la création du client et getClaims() (recommandation Supabase).
  const { data } = await supabase.auth.getClaims();
  const isLoggedIn = Boolean(data?.claims?.sub);
  const path = request.nextUrl.pathname;

  // Expiration après inactivité : un appareil oublié ou perdu ne reste pas connecté indéfiniment.
  if (isLoggedIn) {
    const lastSeen = Number(request.cookies.get(LAST_SEEN_COOKIE)?.value ?? 0);
    const now = Date.now();
    if (lastSeen && now - lastSeen > INACTIVITY_DAYS * 86_400_000) {
      await supabase.auth.signOut({ scope: "local" });
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "?expired=1";
      const redirect = NextResponse.redirect(url);
      response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
      redirect.cookies.delete(LAST_SEEN_COOKIE);
      return redirect;
    }
    // Mis à jour au plus une fois toutes les 12 h pour limiter les en-têtes Set-Cookie.
    if (!lastSeen || now - lastSeen > 12 * 3_600_000) {
      response.cookies.set(LAST_SEEN_COOKIE, String(now), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 400 * 86_400,
      });
    }
  }

  if (!isLoggedIn && !PUBLIC_PATHS.some((p) => path.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (isLoggedIn && path === "/login" && request.nextUrl.searchParams.get("expired") !== "1") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
