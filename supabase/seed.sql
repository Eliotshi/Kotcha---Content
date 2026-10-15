-- Données de départ : concurrents suivis.
-- Ajouter son email admin (non versionné) :
--   insert into public.admin_bootstrap (email) values ('vous@exemple.com');
insert into public.competitors (name, website, color) values
  ('Runna', 'https://www.runna.com', '#eb6834'),
  ('Campus Coach', 'https://www.campus.coach', '#2a78d6')
on conflict (name) do nothing;

insert into public.social_accounts (competitor_id, platform, handle, active)
select c.id, v.platform::public.platform, v.handle, true
from (values
  ('Runna', 'instagram', 'runna'),
  ('Runna', 'tiktok', 'runna'),
  ('Runna', 'linkedin', 'https://www.linkedin.com/company/runna/')
) as v(name, platform, handle)
join public.competitors c on c.name = v.name
on conflict (platform, handle) do nothing;
