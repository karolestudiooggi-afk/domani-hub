import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireUser, HttpError } from "../_shared/ai.ts";

/**
 * Stock Image Search — banco de imagens REAL (Pexels).
 * Diferente de openai-image (geração por IA), aqui buscamos
 * fotos de acervo. Chave por usuário via header x-pexels-api-key (fallback env).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-openai-api-key, x-pfm-api-key, x-pexels-api-key, x-apify-api-token, x-firecrawl-api-key, x-higgsfield-api-id, x-higgsfield-api-secret, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface RequestBody {
  query: string;
  count?: number;
  orientation?: "landscape" | "portrait" | "squarish";
}

interface StockImage {
  id: string;
  url: string;
  thumbUrl: string;
  fullUrl: string;
  alt: string;
  author: string;
  authorUrl: string;
  source: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // PORTÃO: exige usuário autenticado (ou chamada interna via service_role).
  // Segunda barreira, além do verify_jwt=true no config.toml.
  try {
    await requireUser(req);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 401;
    const message = e instanceof Error ? e.message : "Não autenticado";
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { query, count = 12, orientation = "squarish" }: RequestBody = await req.json();
    if (!query?.trim()) {
      return new Response(JSON.stringify({ error: "Missing 'query'" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = req.headers.get("x-pexels-api-key") || Deno.env.get("PEXELS_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Pexels não configurado. Adicione sua chave em Configurações." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const pexelsOrientation = orientation === "squarish" ? "square" : orientation;
    const url = new URL("https://api.pexels.com/v1/search");
    url.searchParams.set("query", query.trim());
    url.searchParams.set("per_page", String(Math.min(count, 30)));
    url.searchParams.set("orientation", pexelsOrientation);
    url.searchParams.set("locale", "pt-BR");

    const res = await fetch(url.toString(), { headers: { Authorization: apiKey } });
    if (!res.ok) {
      const txt = await res.text();
      console.error("[stock-search] Pexels error:", res.status, txt);
      const msg = res.status === 401 ? "Chave Pexels inválida." : `Pexels ${res.status}`;
      return new Response(JSON.stringify({ error: msg }), {
        status: res.status === 401 ? 401 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await res.json();
    const images: StockImage[] = (data.photos || []).map((p: {
      id: number; alt?: string; photographer?: string; photographer_url?: string;
      src?: { original?: string; large?: string; medium?: string; tiny?: string };
    }) => ({
      id: String(p.id),
      url: p.src?.large || p.src?.medium || p.src?.original || "",
      thumbUrl: p.src?.tiny || p.src?.medium || "",
      fullUrl: p.src?.original || p.src?.large || "",
      alt: p.alt || query.trim(),
      author: p.photographer || "Pexels",
      authorUrl: p.photographer_url || "https://www.pexels.com",
      source: "pexels",
    }));

    return new Response(JSON.stringify({ images }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    console.error("stock-search error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
