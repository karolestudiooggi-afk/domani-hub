-- =====================================================================
--  CORRIGIR AS TABELAS DO HUB — SEM APAGAR NADA
--
--  As tabelas hub_* estão com colunas diferentes das que o app usa
--  (por isso os erros 400). Este script apenas ADICIONA as colunas que
--  faltam, copiando a definição da tabela correspondente do Agentes.
--
--  Nada é apagado. Nenhuma tabela é recriada. Nenhum dado se perde.
--
--  Rode no SQL Editor. Idempotente.
-- =====================================================================

do $$
declare
  t     text;
  col   record;
  n_add int := 0;
  tabelas text[] := array[
    'user_configs','user_roles','brand_profiles','creations','saved_sources',
    'analytics_snapshots','autopilot_configs','autopilot_calendars',
    'autopilot_posts','system_settings'
  ];
begin
  foreach t in array tabelas loop
    -- Precisa existir a referência (tabela do Agentes) e a do Hub
    if not exists (select 1 from information_schema.tables
                   where table_schema='public' and table_name=t)
    or not exists (select 1 from information_schema.tables
                   where table_schema='public' and table_name='hub_'||t) then
      continue;
    end if;

    -- Para cada coluna que existe na tabela do Agentes mas falta na do Hub
    for col in
      select c.column_name, c.data_type, c.udt_name, c.column_default, c.is_nullable
      from information_schema.columns c
      where c.table_schema='public' and c.table_name=t
        and not exists (
          select 1 from information_schema.columns h
          where h.table_schema='public' and h.table_name='hub_'||t
            and h.column_name = c.column_name
        )
    loop
      execute format(
        'alter table public.%I add column if not exists %I %s%s',
        'hub_'||t,
        col.column_name,
        case when col.data_type = 'ARRAY' then
               (select format_type(a.atttypid, a.atttypmod)
                from pg_attribute a
                join pg_class cl on cl.oid = a.attrelid
                join pg_namespace n on n.oid = cl.relnamespace
                where n.nspname='public' and cl.relname=t
                  and a.attname=col.column_name)
             when col.data_type = 'USER-DEFINED' then col.udt_name
             else col.data_type end,
        case when col.column_default is not null
             then ' default ' || col.column_default else '' end
      );
      n_add := n_add + 1;
      raise notice 'hub_%: coluna % adicionada', t, col.column_name;
    end loop;
  end loop;

  raise notice '── % coluna(s) adicionada(s) ──', n_add;
end $$;


-- ── Coluna do vínculo marca ↔ contas ─────────────────────────────────
alter table public.hub_brand_profiles
  add column if not exists social_account_ids text[] default '{}';


-- ── Bucket de mídia (o upload depende dele) ──────────────────────────
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

drop policy if exists "media_insert_own" on storage.objects;
create policy "media_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "media_select_all" on storage.objects;
create policy "media_select_all" on storage.objects for select to authenticated, anon
  using (bucket_id = 'media');

drop policy if exists "media_update_own" on storage.objects;
create policy "media_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "media_delete_own" on storage.objects;
create policy "media_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);


notify pgrst, 'reload schema';

-- Conferência: as colunas de hub_creations
select column_name from information_schema.columns
where table_schema='public' and table_name='hub_creations'
order by ordinal_position;
