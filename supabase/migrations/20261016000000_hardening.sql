-- Durcissement suite à la revue : scores à âge égal, posts épinglés / sponsorisés, plafonds de coûts,
-- RGPD (minimisation), restriction de domaine, RLS resserrée, idempotence, qualité des données, alertes, sessions.
-- Volontairement sans instruction destructive (DROP / DELETE) : policies restrictives ajoutées plutôt que remplacées,
-- vue étendue par CREATE OR REPLACE, colonne posts.raw conservée mais plus écrite.

-- ───────────────────────── Réglages ─────────────────────────
alter table public.app_settings
  add column allowed_email_domains text[] not null default '{}',     -- vide = inscription ouverte
  add column monthly_budget_apify_usd numeric(10, 2) not null default 30,
  add column monthly_budget_ai_usd numeric(10, 2) not null default 30,
  add column daily_limit_manual_collections integer not null default 3,   -- pour toute l'équipe
  add column daily_limit_scripts_per_user integer not null default 15,
  add column daily_limit_reprocess_per_user integer not null default 20,
  add column retention_months integer not null default 12;

-- ───────────────────────── Analyses ─────────────────────────
alter table public.analyses
  add column confidence text,                              -- high | medium | low (auto-évaluation du modèle)
  add column uncertainties text,
  add column suspicious_content boolean not null default false,
  add column format_locked boolean not null default false, -- correction manuelle : une ré-analyse ne l'écrase pas
  add column edited_by uuid references public.profiles (id) on delete set null,
  add column edited_at timestamptz;

-- ───────────────────────── Collectes ─────────────────────────
alter table public.scrape_runs
  add column purpose text not null default 'posts',        -- posts | media
  add column post_ids uuid[] not null default '{}',        -- collecte média : posts concernés
  add column quality jsonb,
  add column health text;                                  -- ok | warning | error

-- Un relevé par post et par collecte : un webhook rejoué ne crée pas de doublon.
alter table public.post_metrics
  add column scrape_run_id uuid references public.scrape_runs (id) on delete set null;
create unique index post_metrics_run_unique on public.post_metrics (post_id, scrape_run_id);

-- ───────────────────────── Posts ─────────────────────────
alter table public.posts
  add column source_keys text[] not null default '{}',     -- clés présentes dans la réponse Apify (détection des changements de format)
  add column is_pinned boolean not null default false,
  add column is_paid_partnership boolean not null default false,
  add column is_collab boolean not null default false,
  add column media_ready boolean not null default true,    -- false tant qu'une collecte média (vidéo TikTok, lien Instagram rafraîchi) est attendue
  add column media_refresh_count integer not null default 0,
  add column analysis_quality text,                        -- full | partial
  add column analysis_inputs jsonb,                        -- ce que l'IA a réellement reçu
  -- score de performance à âge égal (calculé par l'app après chaque collecte, cf. src/lib/scoring.ts)
  add column perf_metric text,                             -- views | interactions
  add column perf_value bigint,
  add column perf_age_hours numeric,
  add column perf_per_hour numeric,
  add column perf_baseline numeric,
  add column perf_score numeric,
  add column perf_sample integer,
  add column perf_confidence text,                         -- high | medium | low
  add column perf_estimated boolean not null default false,
  add column score_updated_at timestamptz;

create index on public.posts (account_id, is_pinned);

comment on column public.posts.raw is 'Obsolète (minimisation RGPD) : plus écrite par l''application.';

-- ───────────────────────── Consommation et alertes ─────────────────────────
create table public.usage_events (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles (id) on delete set null,
  kind text not null,             -- ai_analysis | ai_script | transcription | manual_collection | reprocess
  cost_usd numeric(10, 4) not null default 0,
  ref_id uuid,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index on public.usage_events (created_at desc);
create index on public.usage_events (kind, user_id, created_at desc);

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  level text not null check (level in ('info', 'warning', 'critical')),
  kind text not null,
  message text not null,
  dedupe_key text,
  ref jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null
);
create unique index alerts_open_dedupe on public.alerts (dedupe_key) where resolved_at is null;
create index on public.alerts (created_at desc);

alter table public.usage_events enable row level security;
alter table public.alerts enable row level security;

create policy "usage_events: admin read" on public.usage_events
  for select to authenticated using ((select public.is_admin()));
create policy "alerts: approved read" on public.alerts
  for select to authenticated using ((select public.is_approved()));
create policy "alerts: admin resolve" on public.alerts
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ───────────────────────── Inscription limitée à des domaines ─────────────────────────
-- Le refus a lieu dans la base : impossible à contourner en appelant l'API Auth directement.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_bootstrap boolean;
  domains text[];
begin
  select exists (
    select 1 from public.admin_bootstrap b where lower(b.email) = lower(new.email)
  ) into is_bootstrap;

  select s.allowed_email_domains into domains from public.app_settings s where s.id = 1;
  if not is_bootstrap
     and coalesce(array_length(domains, 1), 0) > 0
     and not (lower(split_part(new.email, '@', 2)) = any (select lower(d) from unnest(domains) d)) then
    raise exception 'email_domain_not_allowed' using errcode = 'P0001';
  end if;

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

-- ───────────────────────── Sessions (admin) ─────────────────────────
create or replace function public.admin_list_users()
returns table (
  id uuid,
  email text,
  role public.profile_role,
  status public.profile_status,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  active_sessions integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select p.id, p.email, p.role, p.status, p.created_at, u.last_sign_in_at,
           (select count(distinct r.session_id)::integer from auth.refresh_tokens r
             where r.user_id = p.id::text and not r.revoked)
    from public.profiles p
    left join auth.users u on u.id = p.id
    order by (p.status = 'pending') desc, p.created_at desc;
end;
$$;

-- Révoque tous les jetons de rafraîchissement : chaque appareil est déconnecté à la prochaine
-- actualisation (au plus tard 1 h). L'accès aux données, lui, dépend du statut (RLS) et coupe immédiatement.
create or replace function public.admin_revoke_sessions(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update auth.refresh_tokens set revoked = true, updated_at = now()
  where user_id = target::text and not revoked;
end;
$$;

revoke execute on function public.admin_list_users() from public, anon;
revoke execute on function public.admin_revoke_sessions(uuid) from public, anon;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_revoke_sessions(uuid) to authenticated;

-- ───────────────────────── RLS resserrée ─────────────────────────
-- Policies restrictives : elles s'ajoutent (ET logique) aux policies permissives existantes.
create policy "competitors: delete admin only" on public.competitors
  as restrictive for delete to authenticated using ((select public.is_admin()));
create policy "social_accounts: delete admin only" on public.social_accounts
  as restrictive for delete to authenticated using ((select public.is_admin()));
create policy "generated_scripts: delete author or admin" on public.generated_scripts
  as restrictive for delete to authenticated
  using (created_by = (select auth.uid()) or (select public.is_admin()));
create policy "generated_scripts: insert as self" on public.generated_scripts
  as restrictive for insert to authenticated
  with check (created_by = (select auth.uid()));

-- Posts en lecture seule côté API : les écritures passent par le serveur, qui ne modifie que les champs prévus.
alter policy "posts: approved update" on public.posts using (false) with check (false);

-- ───────────────────────── Vue feed ─────────────────────────
-- Colonnes historiques conservées (même ordre) avec leur nouveau sens :
-- perf = valeur de la métrique, median_perf = référence à âge égal, outlier_score = score à âge égal,
-- engagement_rate = engagement par vue (par abonné pour LinkedIn).
create or replace view public.post_feed
with (security_invoker = true)
as
select
  p.id,
  p.account_id,
  p.platform,
  p.external_id,
  p.url,
  p.media_type,
  p.caption,
  p.hashtags,
  p.published_at,
  p.duration_sec,
  p.thumbnail_path,
  p.thumbnail_source_url,
  p.views,
  p.likes,
  p.comments,
  p.shares,
  p.saves,
  p.metrics_updated_at,
  p.processing_status,
  p.perf_value as perf,
  p.perf_baseline::double precision as median_perf,
  p.perf_score as outlier_score,
  case
    when p.views > 0 then round(
      ((coalesce(p.likes, 0) + coalesce(p.comments, 0) + coalesce(p.shares, 0) + coalesce(p.saves, 0))::numeric / p.views) * 100, 2)
    when p.platform = 'linkedin' and coalesce(p.followers_at_capture, sa.followers) > 0 then round(
      ((coalesce(p.likes, 0) + coalesce(p.comments, 0) + coalesce(p.shares, 0))::numeric
        / coalesce(p.followers_at_capture, sa.followers)) * 100, 2)
  end as engagement_rate,
  sa.handle,
  sa.competitor_id,
  c.name as competitor_name,
  c.color as competitor_color,
  a.format,
  a.hook,
  a.hook_type,
  a.theme,
  p.analysis_quality,
  p.is_pinned,
  p.is_paid_partnership,
  p.is_collab,
  p.perf_metric,
  p.perf_age_hours,
  p.perf_per_hour,
  p.perf_sample,
  p.perf_confidence,
  p.perf_estimated,
  case when p.views > 0 then 'per_view' when p.platform = 'linkedin' then 'per_follower' end as engagement_basis,
  a.confidence as analysis_confidence
from public.posts p
join public.social_accounts sa on sa.id = p.account_id
join public.competitors c on c.id = sa.competitor_id
left join public.analyses a on a.post_id = p.id;
