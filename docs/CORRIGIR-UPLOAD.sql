-- =====================================================================
--  CORRIGIR O UPLOAD DE ARQUIVOS
--
--  Sintoma: "logo do cliente" e "foto de perfil" não aceitam nenhum
--  formato (jpg, png, pdf). Galeria funciona, mas o resto não.
--
--  Causa: a política do storage exige que o arquivo seja salvo dentro da
--  pasta do próprio usuário. Alguns uploads gravavam em outras pastas
--  (brands/…, studio/…, marca/…) e eram recusados.
--
--  O código já foi corrigido para usar sempre {id_do_usuario}/…
--  Este SQL garante que o bucket e as políticas estejam no lugar.
--
--  Rode no SQL Editor. Idempotente.
-- =====================================================================

-- ── Bucket ───────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do update set public = true;


-- ── Políticas ────────────────────────────────────────────────────────
-- Envio: cada usuário grava dentro da própria pasta.
drop policy if exists "media_insert_own" on storage.objects;
create policy "media_insert_own" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Leitura: liberada (as imagens aparecem nos posts e no app).
drop policy if exists "media_select_all" on storage.objects;
create policy "media_select_all" on storage.objects for select to authenticated, anon
  using (bucket_id = 'media');

-- Substituir arquivo próprio.
drop policy if exists "media_update_own" on storage.objects;
create policy "media_update_own" on storage.objects for update to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Apagar arquivo próprio.
drop policy if exists "media_delete_own" on storage.objects;
create policy "media_delete_own" on storage.objects for delete to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- ── Conferência ──────────────────────────────────────────────────────
select
  policyname as politica,
  cmd        as operacao
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname like 'media_%'
order by policyname;

-- Devem aparecer 4 linhas: insert, select, update, delete.
