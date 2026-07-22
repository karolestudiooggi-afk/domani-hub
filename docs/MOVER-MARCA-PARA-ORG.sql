-- =====================================================================
--  MOVER UMA MARCA PARA A ORGANIZAÇÃO CERTA
--
--  Situação: marcas do Hub acabaram criadas dentro da organização
--  "Mamma Jamma" (por causa do bug antigo da função de organização).
--  Este script move a marca escolhida — e tudo que pertence a ela —
--  para a organização correta.
--
--  ⚠️ AJUSTE as duas variáveis abaixo antes de rodar.
-- =====================================================================

do $$
declare
  -- ╔═══════════════════════════════════════════════════════════════╗
  -- ║  CONFIGURE                                                     ║
  -- ╚═══════════════════════════════════════════════════════════════╝
  v_marca      text := 'Buger';    -- marca a mover
  v_org_destino text := 'Domani';  -- organização do Hub
  v_email      text := 'ai@estudiooggi.com';
  -- ═════════════════════════════════════════════════════════════════

  v_uid       uuid;
  v_org_id    uuid;
  v_brand_id  uuid;
  v_org_atual uuid;
begin
  select id into v_uid from auth.users where email = lower(v_email);
  if v_uid is null then
    raise exception 'Usuário % não encontrado', v_email;
  end if;

  -- Garante que a organização de destino existe e que o usuário é membro
  select o.id into v_org_id
  from core.organizations o
  join core.memberships m on m.org_id = o.id
  where o.name = v_org_destino and m.user_id = v_uid
  limit 1;

  if v_org_id is null then
    insert into core.organizations (name, kind)
    values (v_org_destino, 'personal')
    returning id into v_org_id;

    insert into core.memberships (org_id, user_id, role)
    values (v_org_id, v_uid, 'admin')
    on conflict (org_id, user_id) do nothing;

    raise notice 'Organização "%" criada.', v_org_destino;
  end if;

  -- Localiza a marca
  select id, org_id into v_brand_id, v_org_atual
  from public.brand_profiles
  where name = v_marca
  limit 1;

  if v_brand_id is null then
    raise notice 'Marca "%" não encontrada — nada a fazer.', v_marca;
    return;
  end if;

  if v_org_atual = v_org_id then
    raise notice 'Marca "%" já está em "%".', v_marca, v_org_destino;
    return;
  end if;

  -- Move a marca e o que pertence a ela
  update public.brand_profiles set org_id = v_org_id where id = v_brand_id;

  update public.brand_materials set org_id = v_org_id where brand_id = v_brand_id;

  -- Configurações de piloto que usam esta marca
  begin
    update public.autopilot_configs set org_id = v_org_id where brand_id = v_brand_id;
  exception when undefined_table or undefined_column then null;
  end;

  raise notice '── PRONTO ──────────────────────────────';
  raise notice '   Marca "%" movida para "%".', v_marca, v_org_destino;
  raise notice '   Faça LOGOUT e LOGIN no app para ver.';
  raise notice '────────────────────────────────────────';
end $$;


-- Conferência: onde está cada marca agora
select b.name as marca, o.name as organizacao, b.is_default
from public.brand_profiles b
left join core.organizations o on o.id = b.org_id
order by o.name, b.name;
