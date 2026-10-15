import "server-only";
import { env } from "@/lib/env";

const API = "https://api.apify.com/v2";

export type ApifyRun = {
  id: string;
  actId: string;
  status: string; // READY | RUNNING | SUCCEEDED | FAILED | TIMED-OUT | ABORTED
  defaultDatasetId: string;
  usageTotalUsd?: number;
  startedAt?: string;
  finishedAt?: string;
};

async function apify<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.apifyToken()}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Apify ${init?.method ?? "GET"} ${path} → ${res.status} ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

/** Lance un actor de façon asynchrone ; Apify rappellera `webhookUrl` à la fin du run. */
export async function startActorRun(actorId: string, input: unknown, webhookUrl: string): Promise<ApifyRun> {
  const webhooks = Buffer.from(
    JSON.stringify([
      {
        eventTypes: ["ACTOR.RUN.SUCCEEDED", "ACTOR.RUN.FAILED", "ACTOR.RUN.TIMED_OUT", "ACTOR.RUN.ABORTED"],
        requestUrl: webhookUrl,
        // Le secret voyage dans un en-tête : il n'apparaît ni dans l'URL ni dans les journaux d'accès.
        headersTemplate: JSON.stringify({ Authorization: `Bearer ${env.apifyWebhookSecret()}` }),
        shouldInterpolateStrings: false,
      },
    ]),
  ).toString("base64");
  const actorPath = encodeURIComponent(actorId.replace("/", "~"));
  const { data } = await apify<{ data: ApifyRun }>(`/acts/${actorPath}/runs?webhooks=${webhooks}`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data;
}

export async function getRun(runId: string): Promise<ApifyRun> {
  const { data } = await apify<{ data: ApifyRun }>(`/actor-runs/${encodeURIComponent(runId)}`);
  return data;
}

export async function getDatasetItems(datasetId: string): Promise<Record<string, unknown>[]> {
  return apify<Record<string, unknown>[]>(
    `/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json&limit=1000`,
  );
}

/** Les médias stockés par Apify (vidéos TikTok, etc.) nécessitent le token pour être téléchargés. */
export function withApifyAuth(url: string): RequestInit | undefined {
  return url.startsWith("https://api.apify.com/") ? { headers: { Authorization: `Bearer ${env.apifyToken()}` } } : undefined;
}
