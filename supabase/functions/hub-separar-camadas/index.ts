/**
 * SEPARAR CAMADAS — recorta os objetos de uma imagem
 *
 * Recebe a URL de uma imagem e devolve as máscaras dos objetos encontrados,
 * usando o SAM (Segment Anything, da Meta) via fal.ai.
 *
 * O front usa essas máscaras para recortar a imagem em PNGs transparentes,
 * que viram camadas móveis no canvas.
 *
 * Chave necessária: FAL_KEY (secret do Supabase ou header x-fal-key).
 */
import { requireUser, HttpError } from "../_shared/ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-openai-api-key, x-pfm-api-key, x-pexels-api-key, x-apify-api-token, x-firecrawl-api-key, x-higgsfield-api-id, x-higgsfield-api-secret, x-cron-secret, x-fal-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface RequestBody {
  /** URL pública da imagem (o fal precisa conseguir baixar). */
  imageUrl: string;
  /**
   * O que separar, em palavras: "pizza", "pessoa", "taça".
   * Vazio = separação automática de tudo que ele encontrar.
   */
  alvo?: string;
  /** Área mínima de uma máscara, em pixels. Evita fragmentos inúteis. */
  areaMinima?: number;
}

function falKey(req: Request): string {
  const doHeader = req.headers.get("x-fal-key")?.trim();
  const key = doHeader || Deno.env.get("FAL_KEY")?.trim();
  if (!key) {
    throw new HttpError(
      400,
      "Separação de camadas não configurada. Defina o secret FAL_KEY no Supabase (crie a chave em fal.ai).",
    );
  }
  return key;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    await requireUser(req);

    const { imageUrl, alvo, areaMinima = 4000 }: RequestBody = await req.json();
    if (!imageUrl?.trim()) {
      throw new HttpError(400, "Informe a imagem a separar.");
    }

    const key = falKey(req);

    // Com alvo em texto usamos o SAM 3 (aceita prompt); sem alvo, o SAM 2
    // em modo automático, que devolve uma máscara por objeto encontrado.
    const usarTexto = !!alvo?.trim();
    const endpoint = usarTexto
      ? "https://fal.run/fal-ai/sam-3/image"
      : "https://fal.run/fal-ai/sam2/auto-segment";

    const payload: Record<string, unknown> = usarTexto
      ? {
          image_url: imageUrl,
          text_prompt: alvo!.trim(),
          return_multiple_masks: true,
        }
      : {
          image_url: imageUrl,
          points_per_side: 24,          // menos pontos = menos fragmentos
          pred_iou_thresh: 0.9,
          stability_score_thresh: 0.95,
          min_mask_region_area: areaMinima,
        };

    console.log(`[separar-camadas] ${usarTexto ? "SAM3/texto" : "SAM2/auto"}`);

    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Key ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const detalhe = await resp.text().catch(() => "");
      console.error("[separar-camadas] fal.ai falhou:", resp.status, detalhe.slice(0, 300));
      throw new HttpError(
        resp.status === 401 || resp.status === 403 ? 400 : 502,
        resp.status === 401 || resp.status === 403
          ? "A chave do fal.ai foi recusada. Confira o secret FAL_KEY."
          : `O serviço de separação respondeu ${resp.status}.`,
      );
    }

    const data = await resp.json();

    // O formato varia entre os endpoints — normalizamos numa lista de URLs.
    const brutas: unknown[] =
      data.individual_masks ??
      data.masks ??
      (data.combined_mask ? [data.combined_mask] : []);

    const mascaras = brutas
      .map((m) => (typeof m === "string" ? m : (m as { url?: string })?.url))
      .filter((u): u is string => !!u)
      .slice(0, 12); // teto de sanidade: 12 camadas já é bastante

    if (!mascaras.length) {
      throw new HttpError(
        422,
        "Não consegui identificar objetos separáveis nesta imagem.",
      );
    }

    return new Response(JSON.stringify({ mascaras }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 502;
    const message = err instanceof Error ? err.message : "Erro ao separar camadas";
    console.error("[separar-camadas]", message);
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
