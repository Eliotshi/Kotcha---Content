-- Kotcha Content — schéma initial
-- Veille concurrentielle (Instagram, TikTok, LinkedIn), analyse IA et génération de scripts.

-- ───────────────────────── Types ─────────────────────────
create type public.platform as enum ('instagram', 'tiktok', 'linkedin');
create type public.profile_status as enum ('pending', 'approved', 'rejected');
create type public.profile_role as enum ('member', 'admin');
create type public.processing_status as enum ('pending', 'processing', 'done', 'failed', 'skipped');
create type public.script_kind as enum ('talking_broll', 'field_interview');
create type public.script_status as enum ('draft', 'validated', 'shot', 'published');

-- ───────────────────────── Comptes utilisateurs ─────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  role public.profile_role not null default 'member',
  status public.profile_status not null default 'pending',
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

-- Emails approuvés automatiquement comme administrateurs à la première connexion.
-- Rempli à la main (SQL) : aucune policy, donc invisible depuis l'API publique.
create table public.admin_bootstrap (
  email text primary key
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_bootstrap boolean;
begin
  select exists (
    select 1 from public.admin_bootstrap b where lower(b.email) = lower(new.email)
  ) into is_bootstrap;

  insert into public.profiles (id, email, role, status, approved_at)
  values (
    new.id,
    new.email,
    case when is_bootstrap then 'admin'::public.profile_role else 'member'::public.profile_role end,
    case when is_bootstrap then 'approved'::public.profile_status else 'pending'::public.profile_status end,
    case when is_bootstrap then now() else null end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create or replace function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.status = 'approved'
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.status = 'approved' and p.role = 'admin'
  );
$$;

-- ───────────────────────── Concurrents et comptes suivis ─────────────────────────
create table public.competitors (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  website text,
  color text not null default '#1baf7a',
  notes text,
  created_at timestamptz not null default now()
);

create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references public.competitors (id) on delete cascade,
  platform public.platform not null,
  handle text not null,         -- instagram/tiktok : nom d'utilisateur ; linkedin : URL de la page entreprise
  display_name text,
  followers integer,
  active boolean not null default true,
  last_scraped_at timestamptz,
  created_at timestamptz not null default now(),
  unique (platform, handle)
);
create index on public.social_accounts (competitor_id);

-- ───────────────────────── Collectes Apify ─────────────────────────
create table public.scrape_runs (
  id uuid primary key default gen_random_uuid(),
  platform public.platform not null,
  apify_run_id text unique,
  actor_id text not null,
  account_ids uuid[] not null default '{}',
  status text not null default 'RUNNING',
  items_count integer,
  new_posts integer,
  cost_usd numeric(10, 4),
  error text,
  trigger text not null default 'cron',   -- cron | manual
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index on public.scrape_runs (started_at desc);

-- ───────────────────────── Posts ─────────────────────────
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.social_accounts (id) on delete cascade,
  platform public.platform not null,
  external_id text not null,
  url text,
  media_type text not null default 'video',   -- video | image | carousel | text | document
  caption text,
  hashtags text[] not null default '{}',
  music text,
  published_at timestamptz,
  duration_sec numeric,
  thumbnail_source_url text,
  thumbnail_path text,          -- copie dans Supabase Storage (bucket "media")
  video_source_url text,        -- lien temporaire fourni par Apify
  subtitles_url text,           -- TikTok : sous-titres automatiques
  -- dernières métriques connues (copie dénormalisée du dernier relevé)
  views bigint,
  likes bigint,
  comments bigint,
  shares bigint,
  saves bigint,
  followers_at_capture integer,
  metrics_updated_at timestamptz,
  -- pipeline transcription + analyse
  processing_status public.processing_status not null default 'pending',
  processing_error text,
  processing_attempts integer not null default 0,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, external_id)
);
create index on public.posts (account_id, published_at desc);
create index on public.posts (published_at desc);
create index on public.posts (processing_status) where processing_status in ('pending', 'failed');

create table public.post_metrics (
  id bigint generated always as identity primary key,
  post_id uuid not null references public.posts (id) on delete cascade,
  captured_at timestamptz not null default now(),
  views bigint,
  likes bigint,
  comments bigint,
  shares bigint,
  saves bigint,
  followers integer
);
create index on public.post_metrics (post_id, captured_at);

create table public.transcripts (
  post_id uuid primary key references public.posts (id) on delete cascade,
  audio_text text,
  onscreen_text text,
  language text,
  source text,                  -- subtitles | openai | none
  created_at timestamptz not null default now()
);

create table public.analyses (
  post_id uuid primary key references public.posts (id) on delete cascade,
  format text,                  -- face_cam | voiceover_broll | interview | tutorial | trend | text_only | carousel | other
  hook text,
  hook_type text,
  structure jsonb,              -- [{ "t": "0-3s", "beat": "hook", "content": "..." }]
  theme text,
  cta text,
  tone text,
  target_audience text,
  why_it_works text,
  script_reconstructed text,
  ideas_for_kotcha jsonb,       -- ["idée 1", ...]
  model text,
  created_at timestamptz not null default now()
);

-- ───────────────────────── Scripts générés ─────────────────────────
create table public.generated_scripts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  kind public.script_kind not null,
  status public.script_status not null default 'draft',
  source_post_ids uuid[] not null default '{}',
  brief text,
  content jsonb not null,
  notes text,
  model text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.generated_scripts (status, updated_at desc);

-- ───────────────────────── Réglages ─────────────────────────
create table public.app_settings (
  id integer primary key default 1 check (id = 1),
  brand_voice text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
insert into public.app_settings (id) values (1);

-- ───────────────────────── updated_at ─────────────────────────
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger posts_touch before update on public.posts
  for each row execute function public.touch_updated_at();
create trigger scripts_touch before update on public.generated_scripts
  for each row execute function public.touch_updated_at();
create trigger settings_touch before update on public.app_settings
  for each row execute function public.touch_updated_at();

-- ───────────────────────── Vue « feed » avec scores ─────────────────────────
-- perf = vues quand la plateforme les expose (Instagram, TikTok), sinon interactions (LinkedIn).
-- outlier_score = perf du post ÷ médiane des perf des 30 derniers posts du même compte.
create or replace view public.post_feed
with (security_invoker = true)
as
with base as (
  select
    p.*,
    coalesce(p.views, coalesce(p.likes, 0) + coalesce(p.comments, 0) + coalesce(p.shares, 0)) as perf
  from public.posts p
),
ranked as (
  select
    b.id,
    b.perf,
    row_number() over (partition by b.account_id order by b.published_at desc nulls last) as rn,
    b.account_id
  from base b
),
medians as (
  select r.account_id, percentile_cont(0.5) within group (order by r.perf) as median_perf
  from ranked r
  where r.rn <= 30
  group by r.account_id
)
select
  b.id,
  b.account_id,
  b.platform,
  b.external_id,
  b.url,
  b.media_type,
  b.caption,
  b.hashtags,
  b.published_at,
  b.duration_sec,
  b.thumbnail_path,
  b.thumbnail_source_url,
  b.views,
  b.likes,
  b.comments,
  b.shares,
  b.saves,
  b.metrics_updated_at,
  b.processing_status,
  b.perf,
  m.median_perf,
  case when m.median_perf > 0 then round((b.perf / m.median_perf)::numeric, 2) end as outlier_score,
  case
    when coalesce(b.followers_at_capture, sa.followers) > 0
      then round(
        ((coalesce(b.likes, 0) + coalesce(b.comments, 0) + coalesce(b.shares, 0))::numeric
          / coalesce(b.followers_at_capture, sa.followers)) * 100, 2)
  end as engagement_rate,
  sa.handle,
  sa.competitor_id,
  c.name as competitor_name,
  c.color as competitor_color,
  a.format,
  a.hook,
  a.hook_type,
  a.theme
from base b
join public.social_accounts sa on sa.id = b.account_id
join public.competitors c on c.id = sa.competitor_id
left join medians m on m.account_id = b.account_id
left join public.analyses a on a.post_id = b.id;

-- ───────────────────────── RLS ─────────────────────────
alter table public.profiles enable row level security;
alter table public.admin_bootstrap enable row level security;
alter table public.competitors enable row level security;
alter table public.social_accounts enable row level security;
alter table public.scrape_runs enable row level security;
alter table public.posts enable row level security;
alter table public.post_metrics enable row level security;
alter table public.transcripts enable row level security;
alter table public.analyses enable row level security;
alter table public.generated_scripts enable row level security;
alter table public.app_settings enable row level security;

-- profils : chacun voit le sien, l'admin voit et modère tout le monde
create policy "profiles: read own or admin" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy "profiles: admin update" on public.profiles
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy "profiles: admin delete" on public.profiles
  for delete to authenticated
  using ((select public.is_admin()));

-- données métier : accessibles à tout compte approuvé
create policy "competitors: approved all" on public.competitors
  for all to authenticated
  using ((select public.is_approved())) with check ((select public.is_approved()));
create policy "social_accounts: approved all" on public.social_accounts
  for all to authenticated
  using ((select public.is_approved())) with check ((select public.is_approved()));
create policy "scrape_runs: approved read" on public.scrape_runs
  for select to authenticated using ((select public.is_approved()));
create policy "posts: approved read" on public.posts
  for select to authenticated using ((select public.is_approved()));
create policy "posts: approved update" on public.posts
  for update to authenticated
  using ((select public.is_approved())) with check ((select public.is_approved()));
create policy "post_metrics: approved read" on public.post_metrics
  for select to authenticated using ((select public.is_approved()));
create policy "transcripts: approved read" on public.transcripts
  for select to authenticated using ((select public.is_approved()));
create policy "analyses: approved read" on public.analyses
  for select to authenticated using ((select public.is_approved()));
create policy "generated_scripts: approved all" on public.generated_scripts
  for all to authenticated
  using ((select public.is_approved())) with check ((select public.is_approved()));
create policy "app_settings: approved read" on public.app_settings
  for select to authenticated using ((select public.is_approved()));
create policy "app_settings: admin update" on public.app_settings
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ───────────────────────── Storage ─────────────────────────
-- Miniatures copiées depuis les CDN (leurs liens expirent). Contenu public des concurrents.
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;
