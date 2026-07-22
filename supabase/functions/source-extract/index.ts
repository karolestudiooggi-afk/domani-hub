import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireUser, openaiKey, OPENAI_TEXT_MODEL, HttpError } from "../_shared/ai.ts";

/**
 * Source Extract — extração de conteúdo (URL/texto) via Firecrawl + IA.
 * URLs → Firecrawl scrape (conteúdo real da página).
 * Texto puro → sumariza via OpenAI.
 * Retorna {id, status, title, content, sourceType} de forma síncrona.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-firecrawl-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface RequestBody {
  sourceType: string;       // "url" | "youtube" | "text" | "article"
  url?: string;
  text?: string;
  customInstructions?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {

    // PORTÃO: nada que custe dinheiro roda sem um usuário autenticado de verdade.

    await requireUser(req);

    const { sourceType, url, text, customInstructions }: RequestBody = await req.json();
    if (!sourceType) return new Response(JSON.stringify({ error: "Missing 'sourceType'" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    let rawContent = "";
    let title = "";

    if (url && (sourceType === "url" || sourceType === "youtube" || sourceType === "article")) {
      // Extrair conteúdo da URL via Firecrawl scrape
      const firecrawlKey = req.headers.get("x-firecrawl-api-key") || Deno.env.get("FIRECRAWL_API_KEY");
      if (!firecrawlKey) {
        return new Response(JSON.stringify({ error: "Firecrawl não configurado. Adicione sua chave em Configurações." }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const scrapeRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: { Authorization: `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
      });

      if (!scrapeRes.ok) {
        const errText = await scrapeRes.text();
        return new Response(JSON.stringify({ error: `Firecrawl ${scrapeRes.status}: ${errText.slice(0, 200)}` }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const scrapeData = await scrapeRes.json();
      rawContent = scrapeData?.data?.markdown || scrapeData?.markdown || "";
      title = scrapeData?.data?.metadata?.title || scrapeData?.metadata?.title || url;
    } else if (text) {
      rawContent = text;
      title = text.slice(0, 80).split("\n")[0] || "Texto fornecido";
    } else {
      return new Response(JSON.stringify({ error: "Forneça 'url' ou 'text'." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Sumarizar o conteúdo com IA (OpenAI). É um BÔNUS: se a chave não
    // estiver configurada, ou a chamada falhar, devolvemos o texto bruto
    // cortado em vez de quebrar a extração inteira.
    let content = rawContent.slice(0, 8000); // cap pra não estourar
    if (rawContent.length > 200) {
      try {
        const apiKey = openaiKey(req);
        const instructions = customInstructions ? `\n\nInstruções adicionais: ${customInstructions}` : "";
        const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: OPENAI_TEXT_MODEL,
            messages: [
              { role: "system", content: `Você é um extrator de conteúdo. Resuma o texto em português brasileiro, preservando os pontos-chave, dados e citações relevantes. Máximo 1500 palavras.${instructions}` },
              { role: "user", content: rawContent.slice(0, 12000) },
            ],
            temperature: 0.3,
            max_tokens: 2048,
          }),
        });
        if (aiRes.ok) {
          const aiData = await aiRes.json();
          const summary = aiData.choices?.[0]?.message?.content;
          if (summary) content = summary;
        }
      } catch { /* usa rawContent cortado */ }
    }

    const id = crypto.randomUUID();
    return new Response(JSON.stringify({
      id,
      status: "completed",
      title,
      content,
      sourceType,
      referenceUrl: url || null,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    const status = err instanceof HttpError ? err.status : 502;
    console.error("source-extract error:", message);
    return new Response(JSON.stringify({ error: message }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
