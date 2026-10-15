import { NextResponse } from "next/server";
import { processPending } from "@/lib/process";
import { purgeExpiredData, runHealthChecks } from "@/lib/maintenance";
import { env } from "@/lib/env";
import { bearer, safeEqual } from "@/lib/secrets";

export const maxDuration = 300;

/** Cron quotidien : contrôles de santé, rétention RGPD, puis rattrapage des posts en attente ou en échec. */
export async function GET(request: Request) {
  if (!safeEqual(bearer(request), env.cronSecret())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  await runHealthChecks();
  const purged = await purgeExpiredData();
  const result = await processPending({ deadlineMs: 200_000 });
  return NextResponse.json({ ...result, purged });
}
