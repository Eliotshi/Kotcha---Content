-- is_approved() / is_admin() ne renseignent que sur l'appelant, mais n'ont pas à être appelables sans session.
-- Le rôle authenticated garde EXECUTE : les policies RLS en ont besoin.
revoke execute on function public.is_approved() from public, anon;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_approved() to authenticated;
grant execute on function public.is_admin() to authenticated;
