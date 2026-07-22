import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireUser, openaiKey, OPENAI_TEXT_MODEL, HttpError } from "../_shared/ai.ts";

/**
 * AI Assist — helper de IA genérico (OpenAI).
 *
 * Recebe um system prompt + prompt do usuário e devolve texto. Usado pelo Studio
 * para "IA em tudo": melhorar prompt de imagem, sugerir direcionamentos, reescrever
 * legenda, propor variações, etc. A composição (incl. contexto de marca) é feita no
 * cliente; aqui só fazemos o proxy para o gateway, sem expor chaves.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-openai-api-key, x-pfm-api-key, x-pexels-api-key, x-apify-api-token, x-firecrawl-api-key, x-higgsfield-api-id, x-higgsfield-api-secret, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface RequestBody {
  prompt: string;
  system?: string;
  temperature?: number;
  expectJson?: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {

    // PORTÃO: nada que custe dinheiro roda sem um usuário autenticado de verdade.

    await requireUser(req);

    const { prompt, system, temperature = 0.8, expectJson = false }: RequestBody = await req.json();
    if (!prompt?.trim()) {
      return new Response(JSON.stringify({ error: "Missing 'prompt'" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = openaiKey(req);
    const messages = [
      {
        role: "system",
        content:
          system ||
          "Você é um assistente de criação de conteúdo para redes sociais. Responda em português brasileiro, de forma direta e útil.",
      },
      { role: "user", content: prompt },
    ];

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_TEXT_MODEL,
        messages,
        temperature,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[ai-assist] gateway error:", response.status, errText);
      if (response.status === 429) throw new Error("Rate limit excedido. Tente novamente em alguns segundos.");
      if (response.status === 402) throw new Error("Créditos de IA esgotados.");
      throw new Error(`Erro na API de IA ${response.status}`);
    }

    const data = await response.json();
    let text: string = data.choices?.[0]?.message?.content ?? "";
    text = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    if (expectJson) {
      try {
        return new Response(JSON.stringify({ json: JSON.parse(text), text }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch {
        // cai pro texto cru abaixo
      }
    }

    return new Response(JSON.stringify({ text }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    const status = err instanceof HttpError ? err.status : 502;
    console.error("ai-assist error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
