-- =====================================================================
--  DIAGNÓSTICO — por que o app prende no /setup?
--
--  Rode no Supabase → SQL Editor. Cada bloco diz se está OK ou qual é o
--  problema. Leia a coluna "resultado".
-- =====================================================================

-- 1) Os schemas existem?
select '1. schemas' as etapa,
  case when count(*) = 2 then '✓ OK — core e app_social existem'
       else '✗ FALTAM schemas — rode o domani-banco-completo.sql' end as resultado
from information_schema.schemata where schema_name in ('core','app_social');

-- 2) A tabela user_configs tem a coluna openai_api_key? (a que faltava no SQL antigo)
select '2. coluna openai' as etapa,
  case when count(*) = 1 then '✓ OK — banco atualizado'
       else '✗ banco DESATUALIZADO — rode o domani-banco-completo.sql de novo' end as resultado
from information_schema.columns
where table_schema='app_social' and table_name='user_configs' and column_name='openai_api_key';

-- 3) A RPC de organização existe?
select '3. rpc org' as etapa,
  case when count(*) >= 1 then '✓ OK — create_org_for_user existe'
       else '✗ FALTA a função — rode o domani-banco-completo.sql' end as resultado
from information_schema.routines
where routine_schema='core' and routine_name='create_org_for_user';

-- 4) O usuário existe e tem identidade? (sem identidade, o login falha)
select '4. usuário' as etapa,
  case when count(distinct u.id) = 1 and count(i.id) >= 1
       then '✓ OK — usuário e identidade existem'
       when count(distinct u.id) = 1 and count(i.id) = 0
       then '✗ usuário SEM identidade — rode o criar-usuario.sql de novo'
       else '✗ usuário NÃO existe — rode o criar-usuario.sql' end as resultado
from auth.users u
left join auth.identities i on i.user_id = u.id
where u.email = 'ai@estudioogi.com';   -- ⚠️ ajuste se seu e-mail for outro

-- 5) O usuário tem organização E config com onboarding concluído?
--    ESTE é o que decide setup vs dashboard.
select '5. onboarding' as etapa,
  case
    when uc.onboarding_completed then '✓ OK — onboarding concluído, vai pro dashboard'
    when uc.id is not null        then '✗ config existe mas onboarding=false — rode o criar-usuario.sql de novo'
    when m.org_id is not null     then '✗ tem org mas NÃO tem config — rode o criar-usuario.sql de novo'
    else '✗ usuário sem organização — rode o criar-usuario.sql de novo'
  end as resultado
from auth.users u
left join core.memberships m       on m.user_id = u.id
left join app_social.user_configs uc on uc.org_id = m.org_id
where u.email = 'ai@estudioogi.com';   -- ⚠️ mesmo e-mail acima

-- =====================================================================
--  Se algum item deu ✗, a mensagem já diz o que rodar.
--  Se TODOS deram ✓ mas o app ainda prende:
--    → o problema é os schemas não estarem EXPOSTOS na API.
--    → Vá em Settings → API → Exposed schemas e adicione: core, app_social
--    (isso não aparece em nenhuma query — é config do painel)
-- =====================================================================
