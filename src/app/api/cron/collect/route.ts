import { NextResponse } from "next/server";
import { startCollection } from "@/lib/collect";
import { env } from "@/lib/env";
import { bearer, safeEqual } from "@/lib/secrets";

export const maxDuration = 60;

/** Cron Vercel (tous les 2 jours) : lance la collecte Apify pour chaque compte actif. */
export async function GET(request: Request) {
  if (!safeEqual(bearer(request), env.cronSecret())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await startCollection({ trigger: "cron" });
  return NextResponse.json(result);
}
