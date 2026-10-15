import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { withApifyAuth } from "@/lib/apify";

const run = promisify(execFile);
const MAX_VIDEO_BYTES = 150 * 1024 * 1024;

export class DownloadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
  /** Lien expiré ou retiré (les liens vidéo Instagram expirent en quelques heures). */
  get expired() {
    return [401, 403, 404, 410].includes(this.status);
  }
}

export async function download(url: string, maxBytes = MAX_VIDEO_BYTES): Promise<{ buffer: Buffer; contentType: string }> {
  if (!/^https:\/\//.test(url)) throw new DownloadError("URL non https refusée", 0);
  const res = await fetch(url, { ...withApifyAuth(url), cache: "no-store", signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new DownloadError(`Téléchargement impossible (${res.status})`, res.status);
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > maxBytes) throw new Error(`Fichier trop lourd (${Math.round(length / 1e6)} Mo)`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > maxBytes) throw new Error(`Fichier trop lourd (${Math.round(buffer.byteLength / 1e6)} Mo)`);
  return { buffer, contentType: res.headers.get("content-type") ?? "application/octet-stream" };
}

async function ffmpegPath(): Promise<string | null> {
  try {
    const mod = (await import("ffmpeg-static")) as unknown as { default: string | null };
    return mod.default ?? null;
  } catch {
    return null;
  }
}

export type VideoAssets = {
  frames: Buffer[]; // JPEG
  audio: { buffer: Buffer; filename: string } | null;
};

/**
 * Extrait quelques images (pour lire le texte à l'écran) et la piste audio (pour la transcription).
 * Si ffmpeg n'est pas disponible, renvoie la vidéo brute comme « audio » (l'API de transcription accepte le mp4).
 */
export async function extractVideoAssets(video: Buffer, durationSec: number | null, frameCount = 5): Promise<VideoAssets> {
  const ffmpeg = await ffmpegPath();
  if (!ffmpeg) {
    return { frames: [], audio: video.byteLength < 25 * 1024 * 1024 ? { buffer: video, filename: "video.mp4" } : null };
  }

  const dir = await mkdtemp(path.join(tmpdir(), "kotcha-"));
  try {
    const input = path.join(dir, "input.mp4");
    await writeFile(input, video);

    const duration = durationSec && durationSec > 0 ? durationSec : 30;
    const frames: Buffer[] = [];
    for (let i = 0; i < frameCount; i++) {
      // Première image très tôt (le hook), puis réparties sur la durée.
      const t = i === 0 ? Math.min(0.8, duration / 10) : (duration * i) / frameCount;
      const out = path.join(dir, `frame-${i}.jpg`);
      try {
        await run(ffmpeg, ["-y", "-ss", t.toFixed(2), "-i", input, "-frames:v", "1", "-vf", "scale=540:-2", "-q:v", "5", out], {
          timeout: 30_000,
        });
        frames.push(await readFile(out));
      } catch {
        // image manquante : on continue avec les autres
      }
    }

    let audio: VideoAssets["audio"] = null;
    try {
      const out = path.join(dir, "audio.mp3");
      await run(ffmpeg, ["-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", out], { timeout: 60_000 });
      audio = { buffer: await readFile(out), filename: "audio.mp3" };
    } catch {
      audio = null; // pas de piste audio
    }

    return { frames, audio };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
