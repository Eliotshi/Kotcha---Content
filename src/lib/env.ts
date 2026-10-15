import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}

export const env = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabasePublishableKey: () => required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  supabaseSecretKey: () => required("SUPABASE_SECRET_KEY"),
  appUrl: () => required("APP_URL").replace(/\/$/, ""),
  cronSecret: () => required("CRON_SECRET"),
  jobsSecret: () => required("JOBS_SECRET"),
  apifyToken: () => required("APIFY_TOKEN"),
  anthropicModel: () => process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
  openaiKey: () => process.env.OPENAI_API_KEY || null,
  transcriptionModel: () => process.env.TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe",
  postsPerAccount: () => Number(process.env.APIFY_POSTS_PER_ACCOUNT || 12),
  actor: (platform: "instagram" | "tiktok" | "linkedin") =>
    ({
      instagram: process.env.APIFY_INSTAGRAM_ACTOR || "apify/instagram-scraper",
      tiktok: process.env.APIFY_TIKTOK_ACTOR || "clockworks/tiktok-scraper",
      linkedin: process.env.APIFY_LINKEDIN_ACTOR || "harvestapi/linkedin-company-posts",
    })[platform],
};
