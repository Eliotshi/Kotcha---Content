import { NextResponse } from "next/server";
import { processPending } from "@/lib/process";
import { env } from "@/lib/env";
import { bearer, safeEqual } from "@/lib/secrets";

export const maxDuration = 300;

/** Cron de rattrapage quotidien : traite les posts restés en attente ou en échec. */
export async function GET(request: Request) {
  if (!safeEqual(bearer(request), env.cronSecret())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await processPending({ deadlineMs: 240_000 });
  return NextResponse.json(result);
}
