-- =====================================================================
--  ONDE ESTÁ CADA COISA?
--  Rode no SQL Editor do projeto compartilhado e me mande o resultado.
-- =====================================================================

-- 1) Quais organizações existem e de quem são
select
  o.name          as organizacao,
  o.id            as org_id,
  u.email         as usuario,
  m.role          as papel,
  m.created_at    as vinculado_em
from core.organizations o
left join core.memberships m on m.org_id = o.id
left join auth.users u       on u.id = m.user_id
order by o.name, m.created_at;

-- 2) Em qual organização está cada marca (o que causa o print)
select
  b.name  as marca,
  o.name  as organizacao,
  b.is_default,
  b.org_id
from public.brand_profiles b
left join core.organizations o on o.id = b.org_id
order by o.name, b.name;

-- 3) A função já está corrigida? (deve procurar pelo NOME)
select
  case when pg_get_functiondef(p.oid) like '%o.name = _nome%'
       then '✓ CORRIGIDA — procura pelo nome'
       else '✗ ANTIGA — ainda pega a primeira org' end as status_funcao
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'core' and p.proname = 'create_org_for_user';

-- 4) Quantos materiais e em qual org
select
  coalesce(o.name, '(sem org)') as organizacao,
  count(*)                      as materiais
from public.brand_materials bm
left join core.organizations o on o.id = bm.org_id
group by o.name;
