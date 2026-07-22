-- =====================================================================
--  DOMANI HUB — SCHEMA PRÓPRIO E SEPARADO
--
--  Cria o schema `domani_hub` com as tabelas do Hub, totalmente separadas
--  das do Domani Agentes (que fica no `public`). Sem conflito possível:
--  são tabelas diferentes, em schemas diferentes.
--
--  ⚠️ PASSO OBRIGATÓRIO DEPOIS DE RODAR:
--     Supabase → Settings → API → Exposed schemas → adicione `domani_hub`
--     Sem isso a API devolve 406 e o app não enxerga nada.
--
--  Rode no SQL Editor. Idempotente.
-- =====================================================================

create schema if not exists domani_hub;

-- ── Permissões do schema ─────────────────────────────────────────────
grant usage on schema domani_hub to anon, authenticated, service_role;
grant usage on schema core       to anon, authenticated, service_role;


-- ── Helper de pertencimento (dentro do schema do Hub) ────────────────
do $$
declare v_schema text;
begin
  select table_schema into v_schema
  from information_schema.tables
  where table_name = 'memberships' and table_schema in ('core','public')
  order by case table_schema when 'core' then 1 else 2 end
  limit 1;

  if v_schema is not null then
    execute format($f$
      create or replace function domani_hub.is_member(_org_id uuid)
      returns boolean language sql stable security definer set search_path = ''
      as 'select exists (
            select 1 from %I.memberships m
            where m.org_id = _org_id and m.user_id = auth.uid()
          )';
    $f$, v_schema);
  else
    execute $f$
      create or replace function domani_hub.is_member(_org_id uuid)
      returns boolean language sql stable security definer set search_path = ''
      as 'select auth.uid() is not null';
    $f$;
  end if;
end $$;

grant execute on function domani_hub.is_member(uuid) to authenticated;

-- Resolve a organização do Hub (nome fixo "Domani")
create or replace function domani_hub.create_org_for_user(_name text default 'Domani')
returns uuid language plpgsql volatile security definer set search_path = ''
as $$
declare
  _uid  uuid := auth.uid();
  _nome text := coalesce(nullif(trim(_name), ''), 'Domani');
  _org  uuid;
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

grant execute on function domani_hub.create_org_for_user(text) to authenticated;

create or replace function domani_hub.current_org_id()
returns uuid language sql stable security definer set search_path = ''
as $$ select m.org_id from core.memberships m
      join core.organizations o on o.id = m.org_id
      where m.user_id = auth.uid() and o.name = 'Domani'
      order by m.created_at asc limit 1 $$;

grant execute on function domani_hub.current_org_id() to authenticated;


-- ── TABELAS ──────────────────────────────────────────────────────────

create table if not exists domani_hub.user_configs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique,
  user_id uuid,
  brand_name text,
  brand_logo_url text,
  openai_api_key text,
  postforme_api_key text,
  pexels_api_key text,
  apify_api_token text,
  firecrawl_api_key text,
  higgsfield_api_id text,
  higgsfield_api_secret text,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists domani_hub.user_roles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  user_id uuid not null,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  unique (org_id, user_id, role)
);

create table if not exists domani_hub.brand_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  user_id uuid,
  name text not null,
  description text,
  tone text not null default 'profissional',
  target_audience text,
  industry text,
  keywords text[],
  avoid_words text[],
  example_posts text[],
  system_prompt text,
  logo_url text,
  colors text[],
  handle text,
  profile_photo_url text,
  website text,
  social_links jsonb default '{}'::jsonb,
  social_account_ids text[] default '{}',
  values text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists domani_hub.brand_materials (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  brand_id uuid,
  user_id uuid,
  kind text not null default 'documento',
  title text not null,
  content text,
  file_url text,
  file_name text,
  tags text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists domani_hub.activity_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  user_id uuid,
  brand_id uuid,
  action text not null,
  title text not null,
  summary text,
  steps jsonb default '[]'::jsonb,
  sources text[],
  status text not null default 'sucesso',
  created_at timestamptz not null default now()
);

create table if not exists domani_hub.creations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  user_id uuid,
  brand_id uuid,
  kind text,
  title text,
  content text,
  media_urls text[],
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists domani_hub.saved_sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  user_id uuid,
  url text,
  title text,
  content text,
  summary text,
  tags text[],
  created_at timestamptz not null default now()
);

create table if not exists domani_hub.analytics_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  platform text,
  account_id text,
  metrics jsonb default '{}'::jsonb,
  captured_at timestamptz not null default now()
);

create table if not exists domani_hub.autopilot_configs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  user_id uuid,
  brand_id uuid,
  name text,
  enabled boolean not null default false,
  frequency text,
  posts_per_cycle int default 1,
  platforms text[],
  social_account_ids text[],
  research_topics text[],
  themes jsonb default '[]'::jsonb,
  visual_format text,
  image_provider text,
  video_model text,
  next_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists domani_hub.autopilot_calendars (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  config_id uuid,
  month date,
  plan jsonb default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists domani_hub.autopilot_posts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  config_id uuid,
  brand_id uuid,
  status text not null default 'rascunho',
  caption text,
  media_urls text[],
  platforms text[],
  social_account_ids text[],
  scheduled_at timestamptz,
  published_at timestamptz,
  pfm_post_id text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists domani_hub.system_settings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique,
  settings jsonb default '{}'::jsonb,
  updated_at timestamptz not null default now()
);


-- ── ÍNDICES ──────────────────────────────────────────────────────────
create index if not exists hub_brand_profiles_org on domani_hub.brand_profiles (org_id);
create index if not exists hub_brand_materials_org on domani_hub.brand_materials (org_id, brand_id, created_at desc);
create index if not exists hub_activity_logs_org on domani_hub.activity_logs (org_id, created_at desc);
create index if not exists hub_creations_org on domani_hub.creations (org_id, created_at desc);
create index if not exists hub_autopilot_posts_org on domani_hub.autopilot_posts (org_id, status);


-- ── RLS: cada organização vê só o que é dela ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'user_configs','user_roles','brand_profiles','brand_materials','activity_logs',
    'creations','saved_sources','analytics_snapshots','autopilot_configs',
    'autopilot_calendars','autopilot_posts','system_settings'
  ] loop
    execute format('alter table domani_hub.%I enable row level security', t);
    execute format('drop policy if exists hub_org_all on domani_hub.%I', t);
    execute format($p$
      create policy hub_org_all on domani_hub.%I for all to authenticated
      using (domani_hub.is_member(org_id))
      with check (domani_hub.is_member(org_id))
    $p$, t);
  end loop;
end $$;

grant all on all tables in schema domani_hub to authenticated, service_role;
grant all on all sequences in schema domani_hub to authenticated, service_role;
alter default privileges in schema domani_hub grant all on tables to authenticated, service_role;


-- ── Recarrega a API ──────────────────────────────────────────────────
notify pgrst, 'reload schema';

select '✓ Schema domani_hub criado com ' || count(*) || ' tabelas.' as resultado
from information_schema.tables where table_schema = 'domani_hub';

-- =====================================================================
--  ⚠️ NÃO ESQUEÇA:
--   1. Settings → API → Exposed schemas → adicione `domani_hub`
--   2. No .env do Hub:  VITE_DB_SCHEMA="domani_hub"
--   3. npm run build
--   4. Logout e login no Hub
-- =====================================================================
