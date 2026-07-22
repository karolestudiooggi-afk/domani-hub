-- =====================================================================
--  SOLUÇÃO DEFINITIVA DO 406 — mover app_social → public
--
--  O 406 vem do PostgREST recusando o schema `app_social` no header
--  Accept-Profile, por mais que ele esteja "exposto". O schema `public`
--  NUNCA dá esse problema — é o padrão que a API sempre aceita.
--
--  Este script move todas as tabelas de app_social para public e recria
--  os espelhos das funções em public. Depois disso, o app funciona sem
--  depender de nenhum schema secundário.
--
--  Rode no SQL Editor. É seguro rodar mais de uma vez.
--
--  IMPORTANTE: rode DEPOIS do banco já existir (banco-completo.sql).
--  Não apaga dados — apenas move as tabelas de schema.
-- =====================================================================

-- ── 1. Move cada tabela de app_social para public ────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'user_configs','brand_profiles','creations','post_history',
    'saved_sources','analytics_snapshots','autopilot_configs',
    'autopilot_calendars','autopilot_posts','user_roles','system_settings'
  ] loop
    -- só move se ainda existir em app_social e ainda não existir em public
    if exists (select 1 from information_schema.tables
               where table_schema='app_social' and table_name=t)
       and not exists (select 1 from information_schema.tables
               where table_schema='public' and table_name=t)
    then
      execute format('alter table app_social.%I set schema public;', t);
    end if;
  end loop;
end $$;

-- ── 2. Funções de identidade acessíveis a partir de public ───────────
--    (o app chama create_org_for_user sem prefixo de schema)

create or replace function public.create_org_for_user(_name text default 'Domani')
returns uuid language sql volatile security definer set search_path = ''
as $$ select core.create_org_for_user(_name); $$;

create or replace function public.current_org_id()
returns uuid language sql stable security definer set search_path = ''
as $$ select core.current_org_id(); $$;

create or replace function public.is_org_member(_org_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select core.is_org_member(_org_id); $$;

create or replace function public.is_org_admin(_org_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select core.is_org_admin(_org_id); $$;

-- ── 3. Permissões em public ──────────────────────────────────────────
grant usage on schema public to authenticated, anon, service_role;
grant all on all tables in schema public to authenticated, service_role;
grant all on all sequences in schema public to authenticated, service_role;

grant execute on function public.create_org_for_user(text) to authenticated;
grant execute on function public.current_org_id()          to authenticated;
grant execute on function public.is_org_member(uuid)       to authenticated;
grant execute on function public.is_org_admin(uuid)        to authenticated;

alter default privileges in schema public grant all on tables to authenticated, service_role;

-- ── 4. Recarrega a API ───────────────────────────────────────────────
notify pgrst, 'reload schema';

-- ── 5. Confirmação ───────────────────────────────────────────────────
select table_name, table_schema
from information_schema.tables
where table_name in ('user_configs','brand_profiles','creations')
order by table_name;
-- ↑ table_schema deve mostrar 'public' para as três
