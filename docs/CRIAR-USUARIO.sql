-- =====================================================================
--  DOMANI SOCIAL HUB — CRIAR UM USUÁRIO DE ACESSO
-- =====================================================================
--
--  O app tem cadastro FECHADO: não existe "criar conta" nem "esqueci a
--  senha". As contas são criadas aqui, manualmente.
--
--  COMO USAR:
--    1. Rode o `domani-banco-completo.sql` ANTES deste (ele cria as tabelas).
--    2. Ajuste o e-mail, a senha e o nome logo abaixo, na seção CONFIGURE.
--    3. Supabase → SQL Editor → cole tudo → Run.
--
--  Pode rodar quantas vezes quiser (é idempotente): se o e-mail já existir,
--  ele apenas ATUALIZA a senha em vez de dar erro.
--
--  Para criar mais usuários depois, é só mudar o e-mail e rodar de novo.
-- =====================================================================

do $$
declare
  -- ╔═══════════════════════════════════════════════════════════════╗
  -- ║  CONFIGURE AQUI                                               ║
  -- ╚═══════════════════════════════════════════════════════════════╝
  v_email    text := 'ai@estudioogi.com';   -- ⚠️ confira: é "estudioogi" ou "estudiooggi"?
  v_password text := 'oggi1234';
  v_nome     text := 'Estúdio Oggi';
  v_org_nome text := 'Domani';
  -- ═════════════════════════════════════════════════════════════════

  v_user_id uuid;
  v_org_id  uuid;
  v_existe  boolean;
begin
  -- pgcrypto é quem faz o hash bcrypt da senha (o mesmo que o Supabase usa).
  create extension if not exists pgcrypto with schema extensions;

  select id into v_user_id from auth.users where email = lower(v_email);
  v_existe := v_user_id is not null;

  if v_existe then
    -- Já existe: só troca a senha e confirma o e-mail.
    update auth.users
    set encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf')),
        email_confirmed_at = coalesce(email_confirmed_at, now()),
        updated_at         = now()
    where id = v_user_id;

    raise notice 'Usuário já existia — senha atualizada. id=%', v_user_id;

  else
    v_user_id := gen_random_uuid();

    -- 1) O usuário em si.
    --    `email_confirmed_at = now()` já deixa a conta confirmada: não
    --    precisa clicar em link de e-mail nenhum, dá pra logar na hora.
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      lower(v_email),
      extensions.crypt(v_password, extensions.gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', v_nome),
      now(), now(),
      '', '', '', ''
    );

    -- 2) A "identidade" de e-mail.
    --    ESTE PASSO É O QUE TODO MUNDO ESQUECE. Sem a linha em
    --    auth.identities, o GoTrue não reconhece o login por e-mail/senha
    --    e devolve "Invalid login credentials" — mesmo com a senha certa.
    insert into auth.identities (
      id, user_id, provider_id, provider, identity_data,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(),
      v_user_id,
      v_user_id::text,
      'email',
      jsonb_build_object(
        'sub',            v_user_id::text,
        'email',          lower(v_email),
        'email_verified', true,
        'phone_verified', false
      ),
      now(), now(), now()
    );

    raise notice 'Usuário criado. id=%', v_user_id;
  end if;

  -- 3) Profile (o trigger já cria, mas garantimos aqui também).
  insert into core.profiles (user_id, email, full_name)
  values (v_user_id, lower(v_email), v_nome)
  on conflict (user_id) do update set email = excluded.email;

  -- 4) A organização do usuário.
  --    Normalmente o app cria sozinho no primeiro login, mas como estamos
  --    provisionando por fora, já deixamos pronta.
  select m.org_id into v_org_id
  from core.memberships m
  where m.user_id = v_user_id
  order by m.created_at asc
  limit 1;

  if v_org_id is null then
    insert into core.organizations (name, kind)
    values (v_org_nome, 'personal')
    returning id into v_org_id;

    insert into core.memberships (org_id, user_id, role)
    values (v_org_id, v_user_id, 'admin')
    on conflict (org_id, user_id) do nothing;
  end if;

  -- 5) Torna o usuário ADMIN do app (libera a rota /admin).
  insert into app_social.user_roles (org_id, user_id, role)
  values (v_org_id, v_user_id, 'admin')
  on conflict (org_id, user_id, role) do nothing;

  -- 6) Config inicial, para o app NÃO cair na tela de onboarding.
  --    Se a linha já existir (execução anterior, ou criada pelo app), força
  --    onboarding_completed = true e garante o user_id preenchido.
  insert into app_social.user_configs (org_id, user_id, brand_name, onboarding_completed)
  values (v_org_id, v_user_id, 'Domani', true)
  on conflict (org_id) do update
    set onboarding_completed = true,
        user_id = coalesce(app_social.user_configs.user_id, excluded.user_id);

  raise notice '── PRONTO ────────────────────────────────';
  raise notice '   e-mail : %', lower(v_email);
  raise notice '   senha  : %', v_password;
  raise notice '   org    : %', v_org_id;
  raise notice '──────────────────────────────────────────';
end $$;


-- =====================================================================
--  CONFERIR (deve devolver 1 linha, com identidade = 1)
-- =====================================================================
select
  u.email,
  u.email_confirmed_at is not null           as email_confirmado,
  count(i.id)                                as identidades,   -- tem que ser 1
  o.name                                     as organizacao,
  m.role                                     as papel
from auth.users u
left join auth.identities  i on i.user_id = u.id
left join core.memberships m on m.user_id = u.id
left join core.organizations o on o.id = m.org_id
where u.email = 'ai@estudioogi.com'          -- ⚠️ mesmo e-mail de cima
group by u.email, u.email_confirmed_at, o.name, m.role;
