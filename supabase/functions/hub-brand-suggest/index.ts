import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireUser, openaiKey, OPENAI_TEXT_MODEL, HttpError } from "../_shared/ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-openai-api-key, x-pfm-api-key, x-pexels-api-key, x-apify-api-token, x-firecrawl-api-key, x-higgsfield-api-id, x-higgsfield-api-secret, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {

    // PORTÃO: nada que custe dinheiro roda sem um usuário autenticado de verdade.

    await requireUser(req);

    const { name, description, industry } = await req.json();

    if (!name) {
      return new Response(JSON.stringify({ error: "Nome da marca é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = openaiKey(req);
    const prompt = `Analise esta marca e sugira automaticamente os campos para um perfil de marketing digital.
OBRIGATÓRIO: Responda inteiramente em português brasileiro (pt-BR). Todos os campos devem estar em português.

MARCA: ${name}
${description ? `DESCRIÇÃO: ${description}` : ""}
${industry ? `SETOR: ${industry}` : ""}

Retorne JSON puro com:
{
  "tone": "um dos: profissional, casual, tecnico, inspirador, humoristico, educativo",
  "target_audience": "público-alvo sugerido",
  "industry": "setor sugerido",
  "keywords": ["5-8 palavras-chave relevantes"],
  "avoid_words": ["3-5 palavras/termos a evitar"],
  "description": "descrição curta e impactante se não fornecida",
  "values": "missão e valores sugeridos",
  "system_prompt": "instruções personalizadas para a IA gerar conteúdo desta marca"
}

Responda APENAS com JSON válido.`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_TEXT_MODEL,
        messages: [
          { role: "system", content: "Você é um especialista em branding e marketing digital. Responda apenas com JSON válido." },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit excedido. Tente novamente." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos de IA esgotados." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "";
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    const status = err instanceof HttpError ? err.status : 502;
    console.error("brand-suggest error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
