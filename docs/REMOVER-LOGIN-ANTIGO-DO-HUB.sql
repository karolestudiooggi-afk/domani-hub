-- =====================================================================
--  REMOVER O LOGIN ANTIGO DO HUB
--
--  O `ai@estudiooggi.com` é o login do Domani AGENTES (Mamma Jamma).
--  Este script tira o vínculo dele com a organização do Hub ("Domani"),
--  de modo que ele deixe de enxergar os dados do Hub.
--
--  ⚠️ NÃO apaga o usuário — ele continua funcionando no Agentes.
--     Só remove o acesso dele à organização do Hub.
--
--  Rode no SQL Editor. Idempotente.
-- =====================================================================

do $$
declare
  v_email_antigo text := 'ai@estudiooggi.com';   -- login do Agentes
  v_email_novo   text := 'equipe@estudiooggi.com'; -- login do Hub
  v_org_hub      text := 'Domani';

  v_uid_antigo uuid;
  v_uid_novo   uuid;
  v_org_id     uuid;
  v_removidos  int;
begin
  select id into v_uid_antigo from auth.users where email = lower(v_email_antigo);
  select id into v_uid_novo   from auth.users where email = lower(v_email_novo);

  if v_uid_novo is null then
    raise exception 'O login do Hub (%) não existe. Rode o CRIAR-LOGIN-HUB.sql antes.', v_email_novo;
  end if;

  -- Organização do Hub
  select o.id into v_org_id
  from core.organizations o
  join core.memberships m on m.org_id = o.id
  where o.name = v_org_hub and m.user_id = v_uid_novo
  limit 1;

  if v_org_id is null then
    raise notice 'O usuário % ainda não tem a organização "%". Faça login nele uma vez e rode de novo.',
      v_email_novo, v_org_hub;
    return;
  end if;

  -- Remove o vínculo do login antigo com a organização do Hub
  if v_uid_antigo is not null then
    delete from core.memberships
    where user_id = v_uid_antigo and org_id = v_org_id;
    get diagnostics v_removidos = row_count;

    if v_removidos > 0 then
      raise notice 'Removido: % não pertence mais à organização "%".', v_email_antigo, v_org_hub;
    else
      raise notice 'Nada a remover — % já não pertencia à organização "%".', v_email_antigo, v_org_hub;
    end if;

    -- Limpa papéis do app na org do Hub (se a tabela existir)
    begin
      delete from domani_hub.user_roles where user_id = v_uid_antigo and org_id = v_org_id;
    exception when undefined_table then null;
    end;
    begin
      delete from public.user_roles where user_id = v_uid_antigo and org_id = v_org_id;
    exception when undefined_table then null;
    end;
  end if;

  raise notice '── PRONTO ──────────────────────────────';
  raise notice '   Hub     → %', v_email_novo;
  raise notice '   Agentes → %', v_email_antigo;
  raise notice '────────────────────────────────────────';
end $$;


-- Conferência: quem pertence a quê
select
  u.email       as login,
  o.name        as organizacao,
  m.role        as papel
from core.memberships m
join auth.users u          on u.id = m.user_id
join core.organizations o  on o.id = m.org_id
where u.email in ('ai@estudiooggi.com', 'equipe@estudiooggi.com')
order by u.email, o.name;
