import { after, NextResponse } from "next/server";
import { processPending, triggerProcessing } from "@/lib/process";
import { env } from "@/lib/env";
import { bearer, safeEqual } from "@/lib/secrets";

export const maxDuration = 300;

/**
 * Traite un lot de posts en arrière-plan puis se relance tant qu'il reste du travail.
 * Répond immédiatement pour que l'appelant n'attende pas.
 */
export async function POST(request: Request) {
  if (!safeEqual(bearer(request), env.jobsSecret())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  after(async () => {
    const { remaining } = await processPending({ deadlineMs: 240_000 });
    if (remaining) await triggerProcessing();
  });
  return NextResponse.json({ accepted: true }, { status: 202 });
}
