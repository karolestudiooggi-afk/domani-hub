# COMO FAZER O BACKEND FUNCIONAR — Domani Agentes

Os erros no console (`406`, `CORS blocked`, "não foi possível resolver a organização")
**não são bugs de código**. São o backend que ainda não foi publicado no seu
Supabase. São 3 passos. Faça na ordem.

---

## Passo 1 — Expor os schemas (resolve os erros 406)

Este é o passo que quase todo mundo esquece, e é o que causa o "não foi
possível resolver a organização" e os erros `406`.

1. Abra o Supabase → seu projeto
2. **Settings** (engrenagem) → **API**
3. Role até **Exposed schemas** (ou "Data API" → "Exposed schemas")
4. Adicione **`core`** e **`app_social`** à lista (deixe `public` também)
5. Salve

Sem isso, o app não enxerga nenhuma tabela — daí o 406 em `user_roles`,
`create_org_for_user`, etc.

---

## Passo 2 — Publicar as Edge Functions (resolve o CORS)

Os erros de CORS em `ai-assist` e `generate-content` acontecem porque essas
funções ainda não existem no servidor. Quando o navegador chama uma função que
não existe, o Supabase responde sem os headers de CORS, e o navegador reporta
como "CORS blocked". Publicando as funções, o erro some.

No terminal, na pasta do projeto:

```bash
# 1. instale a CLI do Supabase (se ainda não tiver)
npm install -g supabase

# 2. faça login (abre o navegador)
supabase login

# 3. conecte ao seu projeto (o ref está em Settings → General)
supabase link --project-ref SEU-PROJECT-REF

# 4. publique TODAS as funções de uma vez
supabase functions deploy
```

Para conferir se subiram: Supabase → **Edge Functions** — devem aparecer as 13
(ai-assist, generate-content, openai-image, postforme-proxy, autopilot-run, etc.).

---

## Passo 3 — Configurar as chaves (resolve os erros de IA)

As funções precisam da chave da OpenAI para gerar texto e imagem.

Supabase → **Edge Functions** → **Secrets** (ou **Manage secrets**):

| Secret | Obrigatório | Valor |
|---|---|---|
| `OPENAI_API_KEY` | **Sim** | sua chave `sk-...` da platform.openai.com |
| `CRON_SECRET` | **Sim** | invente: rode `openssl rand -hex 32` e cole |
| `PEXELS_API_KEY` | Não | se for usar banco de imagens |
| `FIRECRAWL_API_KEY` | Não | se for usar extração de sites |
| `APIFY_API_TOKEN` | Não | se for usar analytics |

Ou pelo terminal:

```bash
supabase secrets set OPENAI_API_KEY=sk-... CRON_SECRET=$(openssl rand -hex 32)
```

Depois de configurar os secrets, as funções já os enxergam (não precisa
re-deployar).

---

## Ordem completa, do zero

Se você está montando tudo agora, a sequência é:

1. Rode `supabase/migrations/20260714000000_init_domani_social_hub.sql` no SQL Editor
2. Rode `docs/criar-usuario.sql` no SQL Editor
3. **Passo 1** acima (expor schemas) ← resolve o 406
4. **Passo 2** acima (deploy functions) ← resolve o CORS
5. **Passo 3** acima (secrets) ← resolve a geração de IA
6. No `.env` do front, confirme `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`

Depois disso, "gerar imagem" funciona.

---

## Como saber que deu certo

Abra o Console do navegador (F12) e tente gerar de novo. Se ainda houver erro:

- **Ainda 406** → o Passo 1 não pegou. Volte em Settings → API → Exposed schemas.
- **Ainda CORS/ERR_FAILED** → o Passo 2 não completou. Rode `supabase functions deploy` de novo e veja se dá erro.
- **Erro "OpenAI não configurada"** → falta o Passo 3 (o secret OPENAI_API_KEY).
- **Erro 401 / "Sessão"** → normal se você não estiver logado; faça login.
