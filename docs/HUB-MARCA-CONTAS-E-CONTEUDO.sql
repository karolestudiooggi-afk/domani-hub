-- =====================================================================
--  DOMANI HUB — Vínculo Marca↔Contas + Materiais por Cliente
--
--  Adiciona:
--    1. brand_profiles.social_account_ids → quais contas de rede social
--       pertencem a cada marca. Evita publicar conteúdo do Cliente A na
--       conta do Cliente B.
--    2. brand_materials → conteúdos que você sobe para CADA cliente
--       (imagens, textos, documentos, links) e que alimentam a IA dele.
--    3. activity_logs → histórico legível do que o sistema fez.
--
--  Tudo em `public`. Rode no SQL Editor. Pode rodar mais de uma vez.
-- =====================================================================

-- ── 0. HELPER DE PERTENCIMENTO ───────────────────────────────────────
do $$
declare
  v_schema text := null;
begin
  select table_schema into v_schema
  from information_schema.tables
  where table_name = 'memberships' and table_schema in ('core','public')
  order by case table_schema when 'core' then 1 else 2 end
  limit 1;

  if v_schema is not null then
    execute format($f$
      create or replace function public.is_org_member(_org_id uuid)
      returns boolean language sql stable security definer set search_path = ''
      as 'select exists (
            select 1 from %I.memberships m
            where m.org_id = _org_id and m.user_id = auth.uid()
          )';
    $f$, v_schema);
    raise notice 'Acesso checado por %.memberships', v_schema;
  else
    execute $f$
      create or replace function public.is_org_member(_org_id uuid)
      returns boolean language sql stable security definer set search_path = ''
      as 'select auth.uid() is not null';
    $f$;
    raise notice 'Sem tabela de membros - acesso a usuarios autenticados.';
  end if;
end $$;

grant execute on function public.is_org_member(uuid) to authenticated;


-- ── 1. VÍNCULO MARCA ↔ CONTAS ────────────────────────────────────────
--  Guarda os IDs das contas do Post for Me que pertencem a esta marca.
--  Com isso, ao escolher a marca no Piloto, só aparecem as contas dela.
do $$
declare v_schema text;
begin
  select table_schema into v_schema
  from information_schema.tables
  where table_name = 'brand_profiles' and table_schema in ('public','app_social')
  limit 1;

  if v_schema is not null then
    execute format(
      'alter table %I.brand_profiles add column if not exists social_account_ids text[] default ''{}''',
      v_schema);
    raise notice 'Coluna social_account_ids adicionada em %.brand_profiles', v_schema;
  else
    raise notice 'ATENCAO: tabela brand_profiles nao encontrada.';
  end if;
end $$;


-- ── 2. MATERIAIS POR CLIENTE ─────────────────────────────────────────
create table if not exists public.brand_materials (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  brand_id    uuid,                       -- de qual cliente é este material
  user_id     uuid,
  kind        text not null default 'documento',  -- imagem | documento | copy | link
  title       text not null,
  content     text,
  file_url    text,
  file_name   text,
  tags        text[],
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists brand_materials_org_idx
  on public.brand_materials (org_id, brand_id, created_at desc);

alter table public.brand_materials enable row level security;

drop policy if exists "materials_all_org" on public.brand_materials;
create policy "materials_all_org"
  on public.brand_materials for all
  to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

grant all on public.brand_materials to authenticated, service_role;


-- ── 3. LOGS DE ATIVIDADE ─────────────────────────────────────────────
create table if not exists public.activity_logs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  user_id     uuid,
  brand_id    uuid,
  action      text not null,
  title       text not null,
  summary     text,
  steps       jsonb default '[]'::jsonb,
  sources     text[],
  status      text not null default 'sucesso',
  created_at  timestamptz not null default now()
);

create index if not exists activity_logs_org_idx
  on public.activity_logs (org_id, created_at desc);

alter table public.activity_logs enable row level security;

drop policy if exists "logs_select_org" on public.activity_logs;
create policy "logs_select_org"
  on public.activity_logs for select
  to authenticated
  using (public.is_org_member(org_id));

drop policy if exists "logs_insert_org" on public.activity_logs;
create policy "logs_insert_org"
  on public.activity_logs for insert
  to authenticated
  with check (public.is_org_member(org_id));

grant all on public.activity_logs to authenticated, service_role;


-- ── 4. Recarrega a API ───────────────────────────────────────────────
notify pgrst, 'reload schema';

select '✓ Vínculo marca-contas, materiais e logs criados.' as resultado;
