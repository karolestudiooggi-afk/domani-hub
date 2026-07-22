-- =====================================================================
--  DOMANI SOCIAL HUB — BANCO COMPLETO, EM UM ARQUIVO SÓ
-- =====================================================================
--
--  COMO USAR:
--    Supabase → SQL Editor → New query → cole ISTO INTEIRO → Run.
--
--  Pode rodar QUANTAS VEZES QUISER. Se der erro no meio, corrija e rode
--  de novo do começo — o script limpa o próprio estado antes de criar.
--
--  DEPOIS DE RODAR, FALTA UM PASSO:
--    Settings → API → Exposed schemas → adicione  core  e  app_social
--    (sem isso o app dá 404 em tudo)
--
--  ⚠️  A PARTE 0 APAGA as tabelas antigas (as que ficaram em `public`
--      pelas migrations velhas). Num projeto novo, pode rodar sem medo.
--      Se você tem dados de verdade lá, faça backup antes.
--
--  ⚠️  APAGUE as migrations antigas da pasta supabase/migrations/.
--      Elas conflitam com este arquivo. Este é o único que vale.
-- =====================================================================


-- =====================================================================
--  PARTE 0 — LIMPEZA
--  Remove o que as migrations antigas deixaram para trás.
-- =====================================================================

-- 0.1 — Tabelas legadas em `public` (o app não usa mais o schema `public`).
drop table if exists public.autopilot_posts      cascade;
drop table if exists public.autopilot_calendars  cascade;
drop table if exists public.autopilot_configs    cascade;
drop table if exists public.analytics_snapshots  cascade;
drop table if exists public.saved_sources        cascade;
drop table if exists public.post_history         cascade;
drop table if exists public.creations            cascade;
drop table if exists public.brand_profiles       cascade;
drop table if exists public.user_configs         cascade;
drop table if exists public.user_roles           cascade;
drop table if exists public.system_settings      cascade;

-- 0.2 — Funções legadas em `public`.
drop function if exists public.handle_updated_at()    cascade;
drop function if exists public.has_role(uuid, text)   cascade;
drop function if exists public.get_vault_secret(text) cascade;

-- 0.3 — Policies antigas do Storage.
--       Os nomes variavam ("Users can upload media", etc). Varremos todas
--       as policies de storage.objects e recriamos as nossas na Parte 3.
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
  loop
    execute format('drop policy if exists %I on storage.objects;', pol.policyname);
  end loop;
end $$;

-- 0.4 — Os schemas do app são recriados do zero a cada execução.
--       É isto que torna o script re-executável sem dar erro.
drop schema if exists app_social cascade;
drop schema if exists core       cascade;


-- =====================================================================
--  PARTE 1 — CORE (identidade: organizações, membros, perfis)
-- =====================================================================

create extension if not exists "pgcrypto";

create schema core;
create schema app_social;

grant usage on schema core       to anon, authenticated, service_role;
grant usage on schema app_social to anon, authenticated, service_role;

create type core.app_role as enum
  ('admin', 'supervisor', 'agent', 'user', 'member', 'viewer');

-- Uma organização = um "espaço" de dados. Todo dado do app pertence a uma.
create table core.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  kind       text default 'personal',
  cnpj       text,
  created_at timestamptz not null default now()
);

-- Quem pertence a qual organização.
create table core.memberships (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references core.organizations(id) on delete cascade,
  user_id              uuid not null references auth.users(id) on delete cascade,
  role                 core.app_role not null default 'admin',
  onboarding_completed boolean not null default false,
  created_at           timestamptz not null default now(),
  unique (org_id, user_id)
);
create index idx_memberships_user on core.memberships(user_id);

create table core.profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  avatar_url  text,
  is_active   boolean not null default true,
  is_approved boolean not null default true,
  status      text default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
--  Funções de identidade.
--  SECURITY DEFINER + search_path travado: evita recursão de RLS e
--  impede sequestro de search_path.
-- ---------------------------------------------------------------------

-- "Este usuário é membro desta organização?" — é o coração do RLS.
create or replace function core.is_org_member(_org_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from core.memberships m
    where m.org_id = _org_id and m.user_id = auth.uid()
  );
$$;

create or replace function core.is_org_admin(_org_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from core.memberships m
    where m.org_id = _org_id
      and m.user_id = auth.uid()
      and m.role in ('admin', 'supervisor')
  );
$$;

-- A organização "atual": a mais antiga de que o usuário é membro.
create or replace function core.current_org_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select m.org_id from core.memberships m
  where m.user_id = auth.uid()
  order by m.created_at asc
  limit 1;
$$;

-- Garante a organização pessoal do usuário logado. IDEMPOTENTE: se já
-- existe, devolve a mesma; se não, cria e o torna admin dela.
-- É o que o app chama no primeiro login (src/lib/org.ts).
create or replace function core.create_org_for_user(_name text default 'Domani')
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _org uuid;
begin
  if _uid is null then
    raise exception 'sem sessão';
  end if;

  select m.org_id into _org
  from core.memberships m
  where m.user_id = _uid
  order by m.created_at asc
  limit 1;

  if _org is not null then
    return _org;
  end if;

  insert into core.organizations (name, kind)
  values (coalesce(nullif(_name, ''), 'Domani'), 'personal')
  returning id into _org;

  insert into core.memberships (org_id, user_id, role)
  values (_org, _uid, 'admin')
  on conflict (org_id, user_id) do nothing;

  return _org;
end;
$$;

grant execute on function core.is_org_member(uuid)       to authenticated;
grant execute on function core.is_org_admin(uuid)        to authenticated;
grant execute on function core.current_org_id()          to authenticated;
grant execute on function core.create_org_for_user(text) to authenticated;

-- Cria o profile automaticamente quando alguém se cadastra.
create or replace function core.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into core.profiles (user_id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name',
             new.raw_user_meta_data ->> 'name')
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function core.handle_new_user();

-- Mantém `updated_at` em dia. Reaproveitado por várias tabelas.
create or replace function core.touch_updated_at()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
--  RLS do core
-- ---------------------------------------------------------------------
alter table core.organizations enable row level security;
alter table core.memberships   enable row level security;
alter table core.profiles      enable row level security;

create policy "org: membros leem" on core.organizations
  for select to authenticated using (core.is_org_member(id));

create policy "org: admin edita" on core.organizations
  for update to authenticated using (core.is_org_admin(id));

create policy "membership: leio as minhas" on core.memberships
  for select to authenticated
  using (user_id = auth.uid() or core.is_org_member(org_id));

create policy "profile: só o meu" on core.profiles
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, update on core.organizations to authenticated;
grant select         on core.memberships   to authenticated;
grant select, insert, update on core.profiles to authenticated;


-- =====================================================================
--  PARTE 2 — APP_SOCIAL (os dados do Social Hub)
-- =====================================================================

-- ---------------------------------------------------------------------
--  Configurações e CHAVES DE API do usuário.
--  Cada integração tem seu campo. Vazio = integração desligada, e o app
--  degrada sem quebrar. Preenchidas na tela de Configurações do app.
-- ---------------------------------------------------------------------
create table app_social.user_configs (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references core.organizations(id) on delete cascade,
  user_id               uuid references auth.users(id) on delete set null,

  brand_name            text not null default 'Domani',
  brand_logo_url        text,
  onboarding_completed  boolean not null default false,

  -- IA. Normalmente vem do secret OPENAI_API_KEY, no servidor.
  -- Este campo só é usado se o usuário quiser usar a PRÓPRIA chave.
  openai_api_key        text,
  anthropic_api_key     text,

  -- Publicação nas redes (Instagram, Facebook, X, LinkedIn, TikTok,
  -- YouTube, Threads, Pinterest, Bluesky) — tudo via Post for Me.
  postforme_api_key     text,

  -- Mídia e pesquisa
  pexels_api_key        text,   -- banco de imagens (grátis)
  unsplash_api_key      text,
  firecrawl_api_key     text,   -- extração de conteúdo de sites
  apify_api_token       text,   -- analytics das redes

  -- Geração de vídeo
  higgsfield_api_id     text,
  higgsfield_api_secret text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (org_id)
);

-- ---------------------------------------------------------------------
--  Marcas — a "marca-raiz" de que toda geração herda a identidade.
-- ---------------------------------------------------------------------
create table app_social.brand_profiles (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references core.organizations(id) on delete cascade,
  user_id           uuid references auth.users(id) on delete set null,
  name              text not null,
  description       text,
  tone              text not null default 'profissional',
  target_audience   text,
  industry          text,
  keywords          text[],
  avoid_words       text[],
  example_posts     text[],
  system_prompt     text,
  logo_url          text,
  colors            text[],
  handle            text,
  profile_photo_url text,
  website           text,
  social_links      jsonb default '{}'::jsonb,
  values            text,
  is_default        boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index idx_brand_profiles_org on app_social.brand_profiles(org_id);

-- ---------------------------------------------------------------------
--  Criações — a galeria (imagens, vídeos, carrosséis).
-- ---------------------------------------------------------------------
create table app_social.creations (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references core.organizations(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,
  type          text not null,                 -- image | video | carousel
  urls          text[] not null default '{}',
  thumbnail_url text,
  prompt        text,
  template_id   text,
  template_name text,
  source_id     uuid,
  published     boolean not null default false,
  metadata      jsonb default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index idx_creations_org_created on app_social.creations(org_id, created_at desc);

-- ---------------------------------------------------------------------
--  Histórico de publicações.
-- ---------------------------------------------------------------------
create table app_social.post_history (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references core.organizations(id) on delete cascade,
  user_id            uuid references auth.users(id) on delete set null,
  platform           text not null,
  account_id         text not null,
  post_submission_id text,
  text_content       text,
  media_urls         text[] default '{}',
  status             text not null default 'pending',  -- pending|published|scheduled|failed
  public_url         text,
  error_message      text,
  scheduled_time     timestamptz,
  published_at       timestamptz,
  created_at         timestamptz not null default now()
);
create index idx_post_history_org_status
  on app_social.post_history(org_id, status, created_at desc);

-- ---------------------------------------------------------------------
--  Fontes salvas — a matéria-prima da curadoria.
-- ---------------------------------------------------------------------
create table app_social.saved_sources (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references core.organizations(id) on delete cascade,
  user_id             uuid references auth.users(id) on delete set null,
  source_type         text not null,
  title               text,
  content             text,
  reference_url       text,
  custom_instructions text,
  created_at          timestamptz not null default now()
);
create index idx_saved_sources_org on app_social.saved_sources(org_id, created_at desc);

-- ---------------------------------------------------------------------
--  Snapshots de analytics das redes.
-- ---------------------------------------------------------------------
create table app_social.analytics_snapshots (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references core.organizations(id) on delete cascade,
  user_id           uuid references auth.users(id) on delete set null,
  platform          text not null,
  username          text not null,
  display_name      text,
  profile_image_url text,
  followers         integer,
  following         integer,
  posts_count       integer,
  avg_likes         numeric,
  avg_comments      numeric,
  avg_views         numeric,
  engagement_rate   numeric,
  recent_posts      jsonb,
  raw_data          jsonb,
  fetched_at        timestamptz not null default now(),
  created_at        timestamptz not null default now()
);
create index idx_analytics_org_platform
  on app_social.analytics_snapshots(org_id, platform, fetched_at desc);

-- ---------------------------------------------------------------------
--  AUTOPILOT — configuração
-- ---------------------------------------------------------------------
create table app_social.autopilot_configs (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references core.organizations(id) on delete cascade,
  user_id            uuid not null references auth.users(id) on delete cascade,
  brand_id           uuid references app_social.brand_profiles(id) on delete set null,
  is_active          boolean not null default false,
  recurrence         text not null default 'weekly',
  posts_per_cycle    integer not null default 3,
  platforms          text[] not null default '{}',
  social_account_ids text[] not null default '{}',
  preferred_days     integer[],
  preferred_times    text[],
  timezone           text not null default 'America/Sao_Paulo',
  research_topics    text[] not null default '{}',
  research_urls      text[],
  reference_accounts text[] not null default '{}',
  content_types      text[],
  themes             jsonb not null default '[]'::jsonb,
  tone               text,
  visual_format      text not null default 'image',
  image_provider     text not null default 'openai',
  video_model        text,
  requires_approval  boolean not null default true,
  last_run_at        timestamptz,
  next_run_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index idx_autopilot_configs_org on app_social.autopilot_configs(org_id);
-- o cron varre por aqui:
create index idx_autopilot_configs_due
  on app_social.autopilot_configs(next_run_at) where is_active;

-- ---------------------------------------------------------------------
--  AUTOPILOT — calendários (cada ciclo de publicação)
-- ---------------------------------------------------------------------
create table app_social.autopilot_calendars (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references core.organizations(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  config_id        uuid not null references app_social.autopilot_configs(id) on delete cascade,
  cycle_start      timestamptz not null,
  cycle_end        timestamptz not null,
  status           text not null default 'draft',
  research_results jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index idx_autopilot_calendars_config
  on app_social.autopilot_calendars(config_id, cycle_start desc);

-- ---------------------------------------------------------------------
--  AUTOPILOT — os posts gerados
-- ---------------------------------------------------------------------
create table app_social.autopilot_posts (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references core.organizations(id) on delete cascade,
  user_id            uuid not null references auth.users(id) on delete cascade,
  calendar_id        uuid not null references app_social.autopilot_calendars(id) on delete cascade,
  platform           text not null,
  text_content       text not null default '',
  hashtags           text[],
  media_urls         text[],
  carousel_data      jsonb,
  visual_creation_id uuid references app_social.creations(id) on delete set null,
  visual_format      text,
  visual_provider    text,
  theme_name         text,
  source_topic       text,
  source_url         text,
  status             text not null default 'draft',
  scheduled_at       timestamptz,
  pfm_post_id        text,
  error_message      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index idx_autopilot_posts_calendar
  on app_social.autopilot_posts(calendar_id, scheduled_at);
create index idx_autopilot_posts_due
  on app_social.autopilot_posts(status, scheduled_at);

-- ---------------------------------------------------------------------
--  Papéis (rota /admin) e configurações do sistema.
-- ---------------------------------------------------------------------
create table app_social.user_roles (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references core.organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'user',       -- admin | user
  created_at timestamptz not null default now(),
  unique (org_id, user_id, role)
);

create table app_social.system_settings (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references core.organizations(id) on delete cascade,
  registration_enabled boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (org_id)
);

-- ---------------------------------------------------------------------
--  Triggers de updated_at
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'user_configs', 'brand_profiles', 'autopilot_configs',
    'autopilot_calendars', 'autopilot_posts', 'system_settings'
  ] loop
    execute format(
      'create trigger trg_touch_%1$s before update on app_social.%1$s
       for each row execute function core.touch_updated_at();', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
--  RLS — todo dado isolado por organização.
--  Um usuário logado NÃO enxerga nem uma linha de outra organização.
--  Um anônimo não enxerga nada.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'user_configs', 'brand_profiles', 'creations', 'post_history',
    'saved_sources', 'analytics_snapshots', 'autopilot_configs',
    'autopilot_calendars', 'autopilot_posts', 'user_roles', 'system_settings'
  ] loop
    execute format('alter table app_social.%I enable row level security;', t);
    execute format('grant select, insert, update, delete on app_social.%I to authenticated;', t);
    execute format(
      'create policy "org members: full access" on app_social.%I
         for all to authenticated
         using (core.is_org_member(org_id))
         with check (core.is_org_member(org_id));', t);
  end loop;
end $$;

-- Exceções: `user_roles` e `system_settings` são sensíveis.
-- Membro LÊ, mas só ADMIN escreve (senão qualquer um se promoveria a admin).
drop policy "org members: full access" on app_social.user_roles;
create policy "user_roles: membro lê" on app_social.user_roles
  for select to authenticated using (core.is_org_member(org_id));
create policy "user_roles: admin escreve" on app_social.user_roles
  for all to authenticated
  using (core.is_org_admin(org_id))
  with check (core.is_org_admin(org_id));

drop policy "org members: full access" on app_social.system_settings;
create policy "system_settings: membro lê" on app_social.system_settings
  for select to authenticated using (core.is_org_member(org_id));
create policy "system_settings: admin escreve" on app_social.system_settings
  for all to authenticated
  using (core.is_org_admin(org_id))
  with check (core.is_org_admin(org_id));


-- =====================================================================
--  PARTE 3 — STORAGE (bucket `media`)
--
--  Trade-off consciente:
--    • O Post for Me PRECISA baixar a mídia por URL para publicá-la nas
--      redes. Um bucket 100% privado quebraria a publicação.
--    • O risco real não era a leitura — era a ENUMERAÇÃO: anônimos
--      listavam as pastas, descobriam os user_ids e baixavam tudo.
--
--  Então: leitura por URL direta continua (o nome do arquivo é um UUID
--  aleatório, não adivinhável), mas NÃO existe policy de SELECT para
--  anônimos — sem ela, o endpoint de listagem devolve vazio.
--  Escrever, alterar e apagar: só o dono da pasta.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', true, 52428800)   -- 50 MB
on conflict (id) do update
  set public = true, file_size_limit = 52428800;

create policy "media: dono lista" on storage.objects
  for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "media: upload próprio" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "media: update próprio" on storage.objects
  for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "media: delete próprio" on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);


-- =====================================================================
--  PRONTO.
--
--  Confira (deve listar 14 tabelas, todas com rowsecurity = true):
--
--    select schemaname, tablename, rowsecurity
--    from pg_tables
--    where schemaname in ('core', 'app_social')
--    order by 1, 2;
--
--  E NÃO ESQUEÇA:
--    Settings → API → Exposed schemas → adicione  core  e  app_social
-- =====================================================================
