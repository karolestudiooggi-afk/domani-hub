# Documentação — Domani Hub

## Guias

**`COMO-FAZER-O-BACKEND-FUNCIONAR.md`**
Passo a passo do deploy: expor schemas, publicar as Edge Functions, configurar
as chaves. Consulte quando algo parar de funcionar no servidor.

**`POSTFORME_API_MAP.md`** e **`postforme-openapi.json`**
Referência da API do Post for Me (publicação nas redes). Útil ao mexer na
integração ou entender o que ela oferece.

**`STUDIO_IMPROVEMENTS.md`**
Backlog de melhorias do Studio. Documento vivo — ideias para o futuro.

## SQLs reutilizáveis

Estes **não** são migrações: são ferramentas para usar quando precisar.

**`CRIAR-LOGIN-HUB.sql`**
Cria um login novo do Hub (ou troca a senha de um existente). Ajuste o e-mail
e a senha no topo do arquivo e rode.

**`CRIAR-USUARIO.sql`**
Cria um usuário genérico com organização própria. Mesma ideia do anterior,
sem estar amarrado ao Hub.

**`MOVER-MARCA-PARA-ORG.sql`**
Move uma marca (cliente) de uma organização para outra. Útil se um cliente
foi cadastrado no lugar errado.

**`ONDE-ESTA-CADA-COISA.sql`**
Diagnóstico: mostra quais organizações existem, em qual delas cada marca está
e se as funções do banco estão corretas. Rode quando algo parecer fora do lugar.

---

As migrações já aplicadas foram removidas — o estado do banco está em
`supabase/migrations/`.
