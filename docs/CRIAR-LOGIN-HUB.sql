-- =====================================================================
--  DOMANI HUB — LOGIN PRÓPRIO DA EQUIPE
--
--  Cria um usuário exclusivo do Hub, com organização própria ("Domani").
--  Como ele NÃO é membro da organização "Mamma Jamma", o isolamento fica
--  garantido: este login nunca enxerga os dados do Agentes, e vice-versa.
--
--  Rode no SQL Editor. Idempotente (rodar de novo só troca a senha).
-- =====================================================================

do $$
declare
  -- ╔═══════════════════════════════════════════════════════════════╗
  -- ║  CREDENCIAIS DO HUB                                            ║
  -- ╚═══════════════════════════════════════════════════════════════╝
  v_email    text := 'equipe@estudiooggi.com';
  v_password text := '7z8-vMZof234goRebp7D';
  v_nome     text := 'Equipe Domani';
  v_org_nome text := 'Domani';
  -- ═════════════════════════════════════════════════════════════════

  v_user_id uuid;
  v_org_id  uuid;
begin
  create extension if not exists pgcrypto with schema extensions;

  -- ── Usuário ────────────────────────────────────────────────────────
  select id into v_user_id from auth.users where email = lower(v_email);

  if v_user_id is null then
    v_user_id := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user_id,
      'authenticated', 'authenticated', lower(v_email),
      extensions.crypt(v_password, extensions.gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', v_nome),
      now(), now(), '', '', '', ''
    );

    -- Sem esta linha o login falha com "Invalid login credentials",
    -- mesmo com a senha correta. É o passo que todo mundo esquece.
    insert into auth.identities (
      id, user_id, provider_id, provider, identity_data,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), v_user_id, v_user_id::text, 'email',
      jsonb_build_object('sub', v_user_id::text, 'email', lower(v_email),
                         'email_verified', true, 'phone_verified', false),
      now(), now(), now()
    );

    raise notice 'Usuário criado: %', lower(v_email);
  else
    update auth.users
    set encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf')),
        email_confirmed_at = coalesce(email_confirmed_at, now()),
        updated_at = now()
    where id = v_user_id;

    raise notice 'Usuário já existia — senha atualizada.';
  end if;

  -- Profile
  begin
    insert into core.profiles (user_id, email, full_name)
    values (v_user_id, lower(v_email), v_nome)
    on conflict (user_id) do update set email = excluded.email;
  exception when undefined_table then null;
  end;

  -- ── Organização "Domani" (só deste usuário) ────────────────────────
  select o.id into v_org_id
  from core.organizations o
  join core.memberships m on m.org_id = o.id
  where o.name = v_org_nome and m.user_id = v_user_id
  limit 1;

  if v_org_id is null then
    -- Reaproveita a org "Domani" se ela já existir (criada por outro script)
    select id into v_org_id from core.organizations where name = v_org_nome limit 1;

    if v_org_id is null then
      insert into core.organizations (name, kind)
      values (v_org_nome, 'personal')
      returning id into v_org_id;
    end if;

    insert into core.memberships (org_id, user_id, role)
    values (v_org_id, v_user_id, 'admin')
    on conflict (org_id, user_id) do nothing;
  end if;

  -- Papel de admin no app
  begin
    insert into public.user_roles (org_id, user_id, role)
    values (v_org_id, v_user_id, 'admin')
    on conflict (org_id, user_id, role) do nothing;
  exception when undefined_table then null;
  end;

  -- Config: já com onboarding concluído (abre direto no dashboard)
  begin
    insert into public.user_configs (org_id, user_id, brand_name, onboarding_completed)
    values (v_org_id, v_user_id, 'Domani', true)
    on conflict (org_id) do update
      set onboarding_completed = true,
          user_id = coalesce(public.user_configs.user_id, excluded.user_id);
  exception when undefined_table then null;
  end;

  raise notice '── LOGIN DO HUB PRONTO ───────────────────';
  raise notice '   e-mail : %', lower(v_email);
  raise notice '   senha  : %', v_password;
  raise notice '   org    : % (%)', v_org_nome, v_org_id;
  raise notice '──────────────────────────────────────────';
end $$;


-- Conferência: cada login com a sua organização
select
  u.email                      as login,
  o.name                       as organizacao,
  count(i.id)                  as identidades
from auth.users u
left join auth.identities  i on i.user_id = u.id
left join core.memberships m on m.user_id = u.id
left join core.organizations o on o.id = m.org_id
where u.email in ('equipe@estudiooggi.com', 'ai@estudiooggi.com')
group by u.email, o.name
order by u.email, o.name;
