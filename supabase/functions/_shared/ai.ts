/**
 * Camada compartilhada das Edge Functions.
 *
 * Três responsabilidades:
 *   1. CORS   — headers padrão + preflight.
 *   2. AUTH   — `requireUser()`: NENHUMA função paga roda sem um usuário
 *               real. Antes disso não existia: qualquer um na internet
 *               chamava a função e gastava a chave de IA do dono
 *               ("denial-of-wallet"). Agora o token é validado ANTES de
 *               qualquer chamada que custe dinheiro.
 *   3. OPENAI — cliente único (texto + imagem). Substitui o gateway do
 *               Lovable / Gemini, que foi removido.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

// ---------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-openai-api-key, x-pfm-api-key, x-pexels-api-key, x-firecrawl-api-key, x-apify-api-token, x-higgsfield-api-id, x-higgsfield-api-secret, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export function preflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  return null;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function fail(message: string, status = 400): Response {
  return json({ error: message }, status);
}

// ---------------------------------------------------------------------
// AUTH — o portão. Nada pago acontece antes disso passar.
// ---------------------------------------------------------------------
export interface AuthedUser {
  id: string;
  email?: string;
  /** token do usuário, para repassar a chamadas que respeitam RLS */
  token: string;
}

/**
 * Valida o JWT do header Authorization contra o GoTrue.
 * Retorna o usuário ou lança — nunca devolve "talvez".
 *
 * Exceção: chamadas INTERNAS entre edge functions (o autopilot chamando
 * a geração de imagem, por exemplo) usam a service_role key. Essas são
 * confiáveis por definição — a chave nunca sai do servidor.
 */
export async function requireUser(req: Request): Promise<AuthedUser> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    throw new HttpError("Não autenticado: faça login.", 401);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) {
    throw new HttpError("Servidor mal configurado (SUPABASE_URL/ANON_KEY).", 500);
  }

  // chamada de sistema (outra edge function nossa)
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceKey && token === serviceKey) {
    return { id: "system", token };
  }

  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    throw new HttpError("Sessão inválida ou expirada.", 401);
  }
  return { id: data.user.id, email: data.user.email ?? undefined, token };
}

/** Cliente Supabase com a identidade do usuário (respeita RLS). */
export function userClient(token: string) {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, db: { schema: "public" } },
  );
}

/** Cliente Supabase com service_role (ignora RLS) — só para o cron. */
export function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "public" } },
  );
}

export class HttpError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/**
 * Envelope padrão: trata CORS, exige login, converte erros em respostas.
 * Use assim:  Deno.serve((req) => handler(req, async (user) => { ... }))
 */
export async function handler(
  req: Request,
  fn: (user: AuthedUser, req: Request) => Promise<Response>,
): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const user = await requireUser(req);
    return await fn(user, req);
  } catch (err) {
    if (err instanceof HttpError) return fail(err.message, err.status);
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    console.error("[edge] erro:", msg);
    return fail(msg, 502);
  }
}

// ---------------------------------------------------------------------
// OPENAI
// ---------------------------------------------------------------------

/** Modelos padrão. Sobrescreva por env se quiser trocar sem mexer no código. */
export const OPENAI_TEXT_MODEL = Deno.env.get("OPENAI_TEXT_MODEL") ?? "gpt-4o-mini";
export const OPENAI_IMAGE_MODEL = Deno.env.get("OPENAI_IMAGE_MODEL") ?? "gpt-image-1";

/**
 * Resolve a chave da OpenAI, nesta ordem:
 *   1. header `x-openai-api-key` (chave do próprio usuário, se ele preencheu)
 *   2. env `OPENAI_API_KEY` (a chave do projeto — o caso normal)
 */
export function openaiKey(req: Request): string {
  const fromHeader = req.headers.get("x-openai-api-key")?.trim();
  const key = fromHeader || Deno.env.get("OPENAI_API_KEY")?.trim();
  if (!key) {
    throw new HttpError(
      "OpenAI não configurada. Defina o secret OPENAI_API_KEY no Supabase (ou informe sua chave em Configurações).",
      400,
    );
  }
  return key;
}

export interface ChatOptions {
  system?: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;
  /** força a resposta a ser um objeto JSON válido */
  json?: boolean;
}

/** Uma chamada de texto à OpenAI. Devolve o conteúdo cru. */
export async function openaiChat(
  req: Request,
  prompt: string,
  opts: ChatOptions = {},
): Promise<string> {
  const key = openaiKey(req);

  const body: Record<string, unknown> = {
    model: opts.model ?? OPENAI_TEXT_MODEL,
    messages: [
      {
        role: "system",
        content:
          opts.system ??
          "Você é um especialista em conteúdo para redes sociais. Responda sempre em português brasileiro, de forma direta e útil.",
      },
      { role: "user", content: prompt },
    ],
    temperature: opts.temperature ?? 0.8,
    max_tokens: opts.maxTokens ?? 2048,
  };
  if (opts.json) body.response_format = { type: "json_object" };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[openai] erro:", res.status, text.slice(0, 500));
    if (res.status === 401) throw new HttpError("Chave da OpenAI inválida.", 401);
    if (res.status === 429) throw new HttpError("Limite da OpenAI atingido. Tente em instantes.", 429);
    if (res.status === 402) throw new HttpError("Créditos da OpenAI esgotados.", 402);
    throw new HttpError(`Erro na OpenAI (${res.status}).`, 502);
  }

  const data = await res.json();
  return (data.choices?.[0]?.message?.content ?? "").trim();
}

/** Chamada de texto que DEVE devolver JSON. Já faz o parse com tolerância a cercas ```. */
export async function openaiJson<T = unknown>(
  req: Request,
  prompt: string,
  opts: ChatOptions = {},
): Promise<T> {
  const raw = await openaiChat(req, prompt, { ...opts, json: true });
  const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(clean) as T;
  } catch {
    console.error("[openai] JSON inválido:", clean.slice(0, 300));
    throw new HttpError("A IA devolveu uma resposta em formato inesperado. Tente de novo.", 502);
  }
}

export interface ImageOptions {
  size?: "1024x1024" | "1024x1536" | "1536x1024" | "auto";
  quality?: "low" | "medium" | "high" | "auto";
  n?: number;
}

/** Geração de imagem (gpt-image). Devolve data URLs em base64. */
export async function openaiImage(
  req: Request,
  prompt: string,
  opts: ImageOptions = {},
): Promise<string[]> {
  const key = openaiKey(req);

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_IMAGE_MODEL,
      prompt,
      n: opts.n ?? 1,
      size: opts.size ?? "1024x1024",
      quality: opts.quality ?? "high",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[openai-image] erro:", res.status, text.slice(0, 500));
    if (res.status === 401) throw new HttpError("Chave da OpenAI inválida.", 401);
    if (res.status === 429) throw new HttpError("Limite da OpenAI atingido. Tente em instantes.", 429);
    throw new HttpError(`Erro ao gerar imagem (${res.status}).`, 502);
  }

  const data = await res.json();
  const items: Array<{ b64_json?: string; url?: string }> = data.data ?? [];
  return items
    .map((i) => (i.b64_json ? `data:image/png;base64,${i.b64_json}` : i.url))
    .filter(Boolean) as string[];
}
