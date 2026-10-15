import { after, NextResponse } from "next/server";
import { ingestRun } from "@/lib/collect";
import { processPending, triggerProcessing } from "@/lib/process";
import { env } from "@/lib/env";
import { bearer, safeEqual } from "@/lib/secrets";

export const maxDuration = 300;

type ApifyWebhookPayload = {
  eventType?: string;
  eventData?: { actorRunId?: string };
  resource?: { id?: string };
};

/** Appelé par Apify à la fin de chaque run : import des posts puis lancement de l'analyse. */
export async function POST(request: Request) {
  // Secret dans l'en-tête Authorization (headersTemplate du webhook), jamais dans l'URL.
  if (!safeEqual(bearer(request), env.apifyWebhookSecret())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as ApifyWebhookPayload;
  const runId = payload.eventData?.actorRunId ?? payload.resource?.id;
  if (!runId || !/^[A-Za-z0-9]{8,40}$/.test(runId)) return NextResponse.json({ error: "missing run id" }, { status: 400 });

  const result = await ingestRun(runId);

  if (!result.skipped && (result.newPosts > 0 || result.purpose === "media")) {
    after(async () => {
      const { remaining } = await processPending({ deadlineMs: 240_000 });
      if (remaining) await triggerProcessing();
    });
  }
  return NextResponse.json(result);
}
