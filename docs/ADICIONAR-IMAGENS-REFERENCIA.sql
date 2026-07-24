-- =====================================================================
--  IMAGENS DE REFERÊNCIA DA MARCA
--
--  Guarda as fotos que representam o visual da marca — a IA usa como
--  referência de estilo ao criar as artes.
--
--  Rode no SQL Editor. Idempotente.
-- =====================================================================

-- Hub (tabelas com prefixo)
alter table if exists public.hub_brand_profiles
  add column if not exists reference_images text[] default '{}';

-- Agentes (tabelas sem prefixo)
alter table if exists public.brand_profiles
  add column if not exists reference_images text[] default '{}';

notify pgrst, 'reload schema';

select '✓ coluna reference_images disponível.' as resultado;
