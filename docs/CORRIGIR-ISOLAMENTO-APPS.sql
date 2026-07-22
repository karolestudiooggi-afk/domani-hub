-- =====================================================================
--  CORRIGIR ISOLAMENTO ENTRE OS APPS (Hub × Agentes)
--
--  PROBLEMA
--  A função create_org_for_user IGNORAVA o nome que o app envia: ela apenas
--  devolvia a PRIMEIRA organização do usuário. Como o mesmo login pertence
--  a mais de uma organização (Domani e Mamma Jamma), os dois apps recebiam
--  a MESMA org — por isso os dados de um apareciam no outro.
--
--  SOLUÇÃO
--  A função passa a procurar a organização PELO NOME que o app manda:
--    • Hub     → VITE_ORG_NAME="Domani"
--    • Agentes → VITE_ORG_NAME="Mamma Jamma"
--  Cada app fica na sua organização, e o RLS (que já filtra por org_id)
--  cuida do isolamento. Nenhuma tabela precisa ser duplicada.
--
--  Rode no SQL Editor do projeto compartilhado. Idempotente.
-- =====================================================================

-- ── 1. Função corrigida, respeitando o nome ──────────────────────────
create or replace function core.create_org_for_user(_name text default 'Domani')
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  _uid  uuid := auth.uid();
  _nome text := coalesce(nullif(trim(_name), ''), 'Domani');
  _org  uuid;
begin
  if _uid is null then
    raise exception 'sem sessão';
  end if;

  -- Procura uma organização DESTE usuário COM ESTE NOME.
  select m.org_id into _org
  from core.memberships m
  join core.organizations o on o.id = m.org_id
  where m.user_id = _uid and o.name = _nome
  order by m.created_at asc
  limit 1;

  if _org is not null then
    return _org;
  end if;

  -- Não existe ainda: cria a organização com este nome e vincula o usuário.
  insert into core.organizations (name, kind)
  values (_nome, 'personal')
  returning id into _org;

  insert into core.memberships (org_id, user_id, role)
  values (_org, _uid, 'admin')
  on conflict (org_id, user_id) do nothing;

  return _org;
end;
$$;

grant execute on function core.create_org_for_user(text) to authenticated;

-- Espelho em public (é por onde o app chama, sem 406)
create or replace function public.create_org_for_user(_name text default 'Domani')
returns uuid language sql volatile security definer set search_path = ''
as $$ select core.create_org_for_user(_name); $$;

grant execute on function public.create_org_for_user(text) to authenticated;


-- ── 2. Recarrega a API ───────────────────────────────────────────────
notify pgrst, 'reload schema';


-- ── 3. CONFERÊNCIA ───────────────────────────────────────────────────
--  Mostra as organizações do usuário. Devem aparecer as duas, separadas.
select o.name as organizacao, o.id as org_id, m.role
from core.memberships m
join core.organizations o on o.id = m.org_id
join auth.users u on u.id = m.user_id
where u.email in ('ai@estudiooggi.com', 'ai@estudioogi.com')
order by o.name;

-- =====================================================================
--  DEPOIS DE RODAR
--
--  1. Confirme o .env de cada app:
--       Hub     → VITE_ORG_NAME="Domani"
--       Agentes → VITE_ORG_NAME="Mamma Jamma"
--  2. Rebuild dos dois fronts (npm run build).
--  3. Faça LOGOUT e LOGIN de novo em cada app — o app guarda a org em
--     cache na sessão; sem relogar, continua na org antiga.
--
--  Se um cliente ainda aparecer no app errado, é porque o dado foi criado
--  com o org_id errado antes desta correção. Use a consulta abaixo para
--  ver onde cada marca está, e mova se necessário:
--
--    select b.name as marca, o.name as organizacao
--    from public.brand_profiles b
--    join core.organizations o on o.id = b.org_id
--    order by o.name, b.name;
-- =====================================================================
