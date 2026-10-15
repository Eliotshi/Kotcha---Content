import "server-only";
import { env } from "@/lib/env";
import { download } from "@/lib/media";

/** Transcription via l'API OpenAI (modèles gpt-4o-*-transcribe ou whisper-1). Renvoie null sans clé. */
export async function transcribeAudio(audio: { buffer: Buffer; filename: string }): Promise<string | null> {
  const key = env.openaiKey();
  if (!key) return null;
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio.buffer)]), audio.filename);
  form.append("model", env.transcriptionModel());
  form.append("response_format", "text");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Transcription échouée (${res.status}) : ${(await res.text()).slice(0, 200)}`);
  const text = (await res.text()).trim();
  return text || null;
}

/** Sous-titres TikTok (WebVTT) → texte brut. */
export async function fetchSubtitles(url: string): Promise<string | null> {
  try {
    const { buffer } = await download(url, 2 * 1024 * 1024);
    const lines = buffer
      .toString("utf8")
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.startsWith("WEBVTT") && !/^\d+$/.test(l.trim()) && !l.includes("-->"));
    const text = lines.join(" ").replace(/\s+/g, " ").trim();
    return text || null;
  } catch {
    return null;
  }
}
