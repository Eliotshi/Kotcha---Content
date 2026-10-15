import { after, NextResponse } from "next/server";
import { ingestRun } from "@/lib/collect";
import { processPending, triggerProcessing } from "@/lib/process";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/secrets";

export const maxDuration = 300;

type ApifyWebhookPayload = {
  eventType?: string;
  eventData?: { actorRunId?: string };
  resource?: { id?: string };
};

/** Appelé par Apify à la fin de chaque run : import des posts puis lancement de l'analyse. */
export async function POST(request: Request) {
  const secret = new URL(request.url).searchParams.get("secret");
  if (!safeEqual(secret, env.jobsSecret())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as ApifyWebhookPayload;
  const runId = payload.eventData?.actorRunId ?? payload.resource?.id;
  if (!runId) return NextResponse.json({ error: "missing run id" }, { status: 400 });

  const result = await ingestRun(runId);

  if (result.newPosts > 0) {
    after(async () => {
      const { remaining } = await processPending({ deadlineMs: 240_000 });
      if (remaining) await triggerProcessing();
    });
  }
  return NextResponse.json(result);
}
