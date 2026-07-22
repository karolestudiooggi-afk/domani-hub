-- =====================================================================
--  HUB → TABELAS EM PUBLIC COM PREFIXO hub_
--
--  O PostgREST recusa servir schemas secundários de forma teimosa (o 406).
--  Em vez de brigar com isso, movemos as tabelas do Hub para o schema
--  `public` — que a API SEMPRE aceita — com o prefixo `hub_` para não
--  colidir com as do Domani Agentes.
--
--  Resultado:
--    domani_hub.brand_profiles  →  public.hub_brand_profiles
--    domani_hub.user_configs    →  public.hub_user_configs
--    ... e assim por diante
--
--  Rode no SQL Editor. Não apaga dados. Idempotente.
-- =====================================================================

do $$
declare
  t text;
  tabelas text[] := array[
    'user_configs','user_roles','brand_profiles','brand_materials','activity_logs',
    'creations','saved_sources','analytics_snapshots','autopilot_configs',
    'autopilot_calendars','autopilot_posts','system_settings'
  ];
begin
  foreach t in array tabelas loop
    -- Já existe com o prefixo? Nada a fazer.
    if exists (select 1 from information_schema.tables
               where table_schema = 'public' and table_name = 'hub_' || t) then
      continue;
    end if;

    if exists (select 1 from information_schema.tables
               where table_schema = 'domani_hub' and table_name = t) then
      -- Cria a cópia em public com estrutura idêntica. O INCLUDING ALL gera
      -- nomes NOVOS para chaves e índices — por isso não colide com as
      -- tabelas de mesmo nome que o Agentes já tem em public.
      execute format(
        'create table public.%I (like domani_hub.%I including all)',
        'hub_' || t, t);

      -- Move os dados
      execute format(
        'insert into public.%I select * from domani_hub.%I',
        'hub_' || t, t);

      -- Remove a original
      execute format('drop table domani_hub.%I cascade', t);

      raise notice 'criada: public.hub_% (dados copiados)', t;
    end if;
  end loop;
end $$;


-- ── Helper de pertencimento em public ────────────────────────────────
do $$
declare v_schema text;
begin
  select table_schema into v_schema
  from information_schema.tables
  where table_name = 'memberships' and table_schema in ('core','public')
  order by case table_schema when 'core' then 1 else 2 end limit 1;

  if v_schema is not null then
    execute format($f$
      create or replace function public.hub_is_member(_org_id uuid)
      returns boolean language sql stable security definer set search_path = ''
      as 'select exists (select 1 from %I.memberships m
                         where m.org_id = _org_id and m.user_id = auth.uid())';
    $f$, v_schema);
  else
    execute $f$
      create or replace function public.hub_is_member(_org_id uuid)
      returns boolean language sql stable security definer set search_path = ''
      as 'select auth.uid() is not null';
    $f$;
  end if;
end $$;

grant execute on function public.hub_is_member(uuid) to authenticated;


-- ── A função de organização do Hub, agora em public ──────────────────
create or replace function public.hub_create_org_for_user(_name text default 'Domani')
returns uuid language plpgsql volatile security definer set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _nome text := coalesce(nullif(trim(_name), ''), 'Domani');
  _org uuid;
begin
  if _uid is null then raise exception 'sem sessão'; end if;

  select m.org_id into _org
  from core.memberships m
  join core.organizations o on o.id = m.org_id
  where m.user_id = _uid and o.name = _nome
  order by m.created_at asc limit 1;

  if _org is not null then return _org; end if;

  insert into core.organizations (name, kind) values (_nome, 'personal')
  returning id into _org;
  insert into core.memberships (org_id, user_id, role) values (_org, _uid, 'admin')
  on conflict (org_id, user_id) do nothing;
  return _org;
end; $$;

grant execute on function public.hub_create_org_for_user(text) to authenticated;


-- ── RLS nas tabelas movidas ──────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'hub_user_configs','hub_user_roles','hub_brand_profiles','hub_brand_materials',
    'hub_activity_logs','hub_creations','hub_saved_sources','hub_analytics_snapshots',
    'hub_autopilot_configs','hub_autopilot_calendars','hub_autopilot_posts','hub_system_settings'
  ] loop
    if exists (select 1 from information_schema.tables
               where table_schema='public' and table_name=t) then
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists hub_org_all on public.%I', t);
      execute format($p$
        create policy hub_org_all on public.%I for all to authenticated
        using (public.hub_is_member(org_id))
        with check (public.hub_is_member(org_id))
      $p$, t);
      execute format('grant all on public.%I to authenticated, service_role', t);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

-- Conferência
select table_name from information_schema.tables
where table_schema = 'public' and table_name like 'hub\_%'
order by table_name;
