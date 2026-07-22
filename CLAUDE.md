# Domani Social Hub — automação de conteúdo para redes sociais

App web (SPA) que gera e publica conteúdo a partir de uma **marca-raiz**: o usuário define a marca, e toda geração (imagem/vídeo/legenda) herda essa identidade. Núcleo: **Studio** (criação) + **Autopilot** (curadoria → aprovação → full-auto, com calendário e cron).

> Setup e deploy: ver `README.md`.

## Stack
- **Frontend:** Vite 5 + React 18 + TypeScript (SPA, sem SSR).
- **UI:** Tailwind 3 + shadcn/ui (Radix) + lucide-react; framer-motion; recharts; sonner.
- **Dados/estado:** @tanstack/react-query · react-router-dom v6 · react-hook-form + zod.
- **Backend:** Supabase (Postgres + Auth + Storage + Edge Functions Deno).
- **IA:** **OpenAI** — `gpt-4o-mini` (texto) e `gpt-image-1` (imagem). Configurável por env.
- **Integrações:** Post for Me (publicação), Pexels, Firecrawl, Apify, Higgsfield (vídeo).
- **Idioma da UI:** pt-BR.

## Comandos
```bash
npm run dev         # dev server (Vite)
npm run build       # build de produção — rodar (0 erros) ANTES de commitar
npm run test        # vitest
npm run lint        # eslint
```

## Estrutura
```
src/
├── pages/            # telas de rota (Studio, Autopilot, Dashboard, Brands, Analytics, ...)
├── components/
│   ├── studio/       # o núcleo Studio: workspace/ (canvas, copilot, publish drawer)
│   ├── autopilot/    # calendário + status
│   ├── layout/       # AppLayout (shell autenticado)
│   └── ui/           # shadcn/ui
├── hooks/            # use-autopilot, use-brands, use-role, use-social
├── contexts/         # AuthContext (sessão) + AppContext (config/chaves/onboarding)
├── lib/
│   ├── api/          # camada que chama as Edge Functions (barrel @/lib/api)
│   ├── org.ts        # resolve a organização do usuário
│   ├── brand.ts      # modelo da marca-raiz
│   └── gallery.ts    # storage/galeria (bucket media)
└── integrations/supabase/   # client + types
```

## Banco — schemas `core` + `app_social`

Fonte da verdade: **`supabase/migrations/20260714000000_init_domani_social_hub.sql`** (migration única).

- **`core`** — identidade: `organizations`, `memberships`, `profiles`.
  RPCs: `create_org_for_user` (idempotente), `current_org_id`, `is_org_member`, `is_org_admin`.
- **`app_social`** — 11 tabelas: `user_configs`, `brand_profiles`, `creations`, `post_history`,
  `saved_sources`, `analytics_snapshots`, `autopilot_configs`, `autopilot_calendars`,
  `autopilot_posts`, `user_roles`, `system_settings`.
- **Modelo de tenancy:** todo dado pertence a uma **organização** (`org_id`). O RLS isola por
  `core.is_org_member(org_id)`. Quem loga ganha a própria org — sem provisionamento manual.
- **Storage:** bucket `media`, path `/{user_id}/...`. Leitura por URL direta (o Post for Me
  precisa baixar a mídia para publicar), mas **sem policy de SELECT para anon** — logo, não dá
  para enumerar as pastas.
- ⚠️ Os schemas `core` e `app_social` precisam estar em **Settings → API → Exposed schemas**.

## Edge Functions (13, `/functions/v1/*`)

`_shared/ai.ts` é a base de todas: **auth guard** (`requireUser`) + **cliente OpenAI**.

| Função | O que faz | Chave |
|---|---|---|
| `generate-content` | Geração de texto por plataforma | env `OPENAI_API_KEY` |
| `openai-image` | Geração de imagem (gpt-image) | env `OPENAI_API_KEY` |
| `ai-assist` | Helper de IA do Copilot do Studio | env `OPENAI_API_KEY` |
| `brand-suggest` | Sugere campos do perfil de marca | env `OPENAI_API_KEY` |
| `analytics-insights` | Insights estratégicos | env `OPENAI_API_KEY` |
| `source-extract` | Extrai conteúdo de URL (Firecrawl) + resume | header/env |
| `postforme-proxy` | **Publicação** (contas, post, agendamento) | header do usuário |
| `higgsfield-proxy` | Geração de vídeo | header do usuário |
| `stock-search` | Pexels | header do usuário |
| `firecrawl-search` | Busca/scrape | header do usuário |
| `social-analytics` | Métricas via Apify | header do usuário |
| `autopilot-run` | Pipeline: generate/curate/schedule/check_visuals/confirm | — |
| `autopilot-cron` | Orquestrador periódico | `CRON_SECRET` |

## Segurança — regras que NÃO devem regredir

1. **Nenhuma função paga roda sem usuário autenticado.** `verify_jwt = true` no `config.toml`
   (barreira do gateway) **+** `requireUser()` no código (barreira da aplicação). Chamadas
   internas entre functions usam a `service_role`.
2. **`autopilot-cron` exige `CRON_SECRET`** (ou service_role). Sem isso, qualquer um dispara
   geração paga e publicação.
3. **RLS em todas as tabelas**, por `org_id`. Anônimo não lê nada.
4. **Zero credencial no repositório.** Front lê do `.env`; servidor, dos secrets do Supabase.
5. **`user_roles` e `system_settings` só são escritos por admin da org.**

## Convenções
- **UI em pt-BR** — todo texto visível ao usuário em português.
- **Rodar o build antes de commitar** (0 erros).
- **Segredos só em `.env` local / secrets do Supabase** — nunca no repo.
- Ao adicionar uma integração: crie o campo em `user_configs` (migration) **e** em `AppConfig`
  (`src/types/index.ts`), e faça a feature **degradar sem quebrar** quando a chave estiver vazia.
