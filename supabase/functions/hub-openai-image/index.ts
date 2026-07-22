import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireUser, openaiKey, OPENAI_IMAGE_MODEL, HttpError } from "../_shared/ai.ts";

/**
 * OpenAI Image Generation proxy.
 *
 * Exige usuário autenticado (geração de imagem custa dinheiro).
 *
 * Resolução da chave (nesta ordem):
 *   1. header `x-openai-api-key` (chave do próprio usuário, opcional)
 *   2. secret OPENAI_API_KEY do Supabase (o caso normal)
 *
 * A chave nunca trafega no bundle do cliente nem no git.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-openai-api-key, x-pfm-api-key, x-pexels-api-key, x-apify-api-token, x-firecrawl-api-key, x-higgsfield-api-id, x-higgsfield-api-secret, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};


interface RequestBody {
  prompt: string;
  size?: string;        // "1024x1024" | "1024x1536" | "1536x1024" | "auto"
  n?: number;
  model?: string;
  quality?: string;     // gpt-image: "low" | "medium" | "high" | "auto"
  background?: string;  // "transparent" | "opaque" | "auto"
  /** Imagem de referência (data URL ou http). Ativa o modo edição. */
  referenceImage?: string;
}

/** Converte data URL ou URL http em Blob, para enviar como arquivo. */
async function toBlob(src: string): Promise<Blob> {
  if (src.startsWith("data:")) {
    const [head, b64] = src.split(",");
    const mime = head.match(/data:(.*?);/)?.[1] ?? "image/png";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  const r = await fetch(src);
  if (!r.ok) throw new Error(`Não foi possível baixar a imagem de referência (${r.status})`);
  return await r.blob();
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
    // PORTÃO: geração de imagem custa dinheiro real — exige usuário autenticado.
    await requireUser(req);

    const body: RequestBody = await req.json();
    const { prompt, size = "1024x1024", n = 1, model, quality, background, referenceImage } = body;

    if (!prompt?.trim()) {
      return new Response(JSON.stringify({ error: "Missing 'prompt'" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = openaiKey(req);

    // Edge Functions têm limite de 150s. `quality: "high"` em gpt-image-2
    // costuma estourar esse limite → rebaixamos para "medium" no servidor.
    const safeQuality = quality === "high" ? "medium" : (quality || "medium");

    const useModel = model || OPENAI_IMAGE_MODEL;
    let resp: Response;

    if (referenceImage?.trim()) {
      // Com foto do usuário → endpoint de EDIÇÃO: a IA parte dela.
      const form = new FormData();
      form.append("model", useModel);
      form.append("prompt", prompt);
      form.append("n", String(n));
      form.append("size", size);
      form.append("quality", safeQuality);
      form.append("image", await toBlob(referenceImage.trim()), "referencia.png");

      resp = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}` },
        body: form,
      });
    } else {
      const payload: Record<string, unknown> = {
        model: useModel, prompt, n, size, quality: safeQuality,
      };
      if (background) payload.background = background;

      resp = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    }

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("[openai-image] OpenAI error:", resp.status, errText);
      let msg = `OpenAI ${resp.status}`;
      try { msg = JSON.parse(errText)?.error?.message || msg; } catch { /* keep raw */ }
      if (resp.status === 401) msg = "Chave OpenAI inválida.";
      if (resp.status === 429) msg = "Limite de taxa ou créditos OpenAI excedido.";
      return new Response(JSON.stringify({ error: msg }), {
        status: resp.status === 401 ? 401 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    // gpt-image-* retorna b64_json; dall-e pode retornar url.
    const images: string[] = (data.data || [])
      .map((d: { b64_json?: string; url?: string }) =>
        d.b64_json ? `data:image/png;base64,${d.b64_json}` : d.url
      )
      .filter(Boolean);

    return new Response(JSON.stringify({ images, model: useModel }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    const status = err instanceof HttpError ? err.status : 502;
    console.error("openai-image error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
