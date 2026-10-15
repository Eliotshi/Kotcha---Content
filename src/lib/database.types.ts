// Généré depuis Supabase (generate_typescript_types), puis allégé des helpers inutilisés.
// À régénérer après chaque migration.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Platform = "instagram" | "tiktok" | "linkedin";
type ProcessingStatus = "pending" | "processing" | "done" | "failed" | "skipped";
type ProfileRole = "member" | "admin";
type ProfileStatus = "pending" | "approved" | "rejected";
type ScriptKind = "talking_broll" | "field_interview";
type ScriptStatus = "draft" | "validated" | "shot" | "published";

type Table<Row, Insert, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

type AnalysisRow = {
  created_at: string;
  cta: string | null;
  format: string | null;
  hook: string | null;
  hook_type: string | null;
  ideas_for_kotcha: Json | null;
  model: string | null;
  post_id: string;
  script_reconstructed: string | null;
  structure: Json | null;
  target_audience: string | null;
  theme: string | null;
  tone: string | null;
  why_it_works: string | null;
};

type AppSettingsRow = { brand_voice: string; id: number; updated_at: string; updated_by: string | null };

type CompetitorRow = {
  color: string;
  created_at: string;
  id: string;
  name: string;
  notes: string | null;
  website: string | null;
};

type GeneratedScriptRow = {
  brief: string | null;
  content: Json;
  created_at: string;
  created_by: string | null;
  id: string;
  kind: ScriptKind;
  model: string | null;
  notes: string | null;
  source_post_ids: string[];
  status: ScriptStatus;
  title: string;
  updated_at: string;
};

type PostMetricsRow = {
  captured_at: string;
  comments: number | null;
  followers: number | null;
  id: number;
  likes: number | null;
  post_id: string;
  saves: number | null;
  shares: number | null;
  views: number | null;
};

type PostRow = {
  account_id: string;
  caption: string | null;
  comments: number | null;
  created_at: string;
  duration_sec: number | null;
  external_id: string;
  followers_at_capture: number | null;
  hashtags: string[];
  id: string;
  likes: number | null;
  media_type: string;
  metrics_updated_at: string | null;
  music: string | null;
  platform: Platform;
  processing_attempts: number;
  processing_error: string | null;
  processing_status: ProcessingStatus;
  published_at: string | null;
  raw: Json | null;
  saves: number | null;
  shares: number | null;
  subtitles_url: string | null;
  thumbnail_path: string | null;
  thumbnail_source_url: string | null;
  updated_at: string;
  url: string | null;
  video_source_url: string | null;
  views: number | null;
};

type ProfileRow = {
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  email: string;
  full_name: string | null;
  id: string;
  role: ProfileRole;
  status: ProfileStatus;
};

type ScrapeRunRow = {
  account_ids: string[];
  actor_id: string;
  apify_run_id: string | null;
  cost_usd: number | null;
  error: string | null;
  finished_at: string | null;
  id: string;
  items_count: number | null;
  new_posts: number | null;
  platform: Platform;
  started_at: string;
  status: string;
  trigger: string;
};

type SocialAccountRow = {
  active: boolean;
  competitor_id: string;
  created_at: string;
  display_name: string | null;
  followers: number | null;
  handle: string;
  id: string;
  last_scraped_at: string | null;
  platform: Platform;
};

type TranscriptRow = {
  audio_text: string | null;
  created_at: string;
  language: string | null;
  onscreen_text: string | null;
  post_id: string;
  source: string | null;
};

type PostFeedRow = {
  account_id: string | null;
  caption: string | null;
  comments: number | null;
  competitor_color: string | null;
  competitor_id: string | null;
  competitor_name: string | null;
  duration_sec: number | null;
  engagement_rate: number | null;
  external_id: string | null;
  format: string | null;
  handle: string | null;
  hashtags: string[] | null;
  hook: string | null;
  hook_type: string | null;
  id: string | null;
  likes: number | null;
  media_type: string | null;
  median_perf: number | null;
  metrics_updated_at: string | null;
  outlier_score: number | null;
  perf: number | null;
  platform: Platform | null;
  processing_status: ProcessingStatus | null;
  published_at: string | null;
  saves: number | null;
  shares: number | null;
  theme: string | null;
  thumbnail_path: string | null;
  thumbnail_source_url: string | null;
  url: string | null;
  views: number | null;
};

type WithOptional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type Database = {
  __InternalSupabase: { PostgrestVersion: "14.18" };
  public: {
    Tables: {
      admin_bootstrap: Table<{ email: string }, { email: string }>;
      analyses: Table<AnalysisRow, WithOptional<AnalysisRow, Exclude<keyof AnalysisRow, "post_id">>>;
      app_settings: Table<AppSettingsRow, Partial<AppSettingsRow>>;
      competitors: Table<CompetitorRow, WithOptional<CompetitorRow, "color" | "created_at" | "id" | "notes" | "website">>;
      generated_scripts: Table<
        GeneratedScriptRow,
        WithOptional<
          GeneratedScriptRow,
          "brief" | "created_at" | "created_by" | "id" | "model" | "notes" | "source_post_ids" | "status" | "updated_at"
        >
      >;
      post_metrics: Table<PostMetricsRow, WithOptional<Omit<PostMetricsRow, "id">, Exclude<keyof Omit<PostMetricsRow, "id">, "post_id">>>;
      posts: Table<PostRow, WithOptional<PostRow, Exclude<keyof PostRow, "account_id" | "external_id" | "platform">>>;
      profiles: Table<ProfileRow, WithOptional<ProfileRow, Exclude<keyof ProfileRow, "email" | "id">>>;
      scrape_runs: Table<ScrapeRunRow, WithOptional<ScrapeRunRow, Exclude<keyof ScrapeRunRow, "actor_id" | "platform">>>;
      social_accounts: Table<
        SocialAccountRow,
        WithOptional<SocialAccountRow, Exclude<keyof SocialAccountRow, "competitor_id" | "handle" | "platform">>
      >;
      transcripts: Table<TranscriptRow, WithOptional<TranscriptRow, Exclude<keyof TranscriptRow, "post_id">>>;
    };
    Views: {
      post_feed: { Row: PostFeedRow; Relationships: [] };
    };
    Functions: {
      is_admin: { Args: never; Returns: boolean };
      is_approved: { Args: never; Returns: boolean };
    };
    Enums: {
      platform: Platform;
      processing_status: ProcessingStatus;
      profile_role: ProfileRole;
      profile_status: ProfileStatus;
      script_kind: ScriptKind;
      script_status: ScriptStatus;
    };
    CompositeTypes: { [_ in never]: never };
  };
};

type PublicSchema = Database["public"];
export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"];
export type Views<T extends keyof PublicSchema["Views"]> = PublicSchema["Views"][T]["Row"];
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];
