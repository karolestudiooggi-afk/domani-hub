import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireUser, HttpError } from "../_shared/ai.ts";

/**
 * Higgsfield AI Video Generation Proxy
 *
 * Unified proxy for all Higgsfield endpoints:
 * - Text-to-image (Soul)
 * - Image-to-video (DoP, Kling, Seedance, Wan)
 * - Status polling
 * - Cancel generation
 *
 * Auth: Key {api_id}:{api_secret}
 * Base URL: https://platform.higgsfield.ai
 *
 * Text-to-video models exposed in the UI (all support native audio in pt-BR):
 * - kling-video/v2.6/pro/text-to-video (validated on account)
 * - veo3/text-to-video (may require allowlist)
 * - veo3-fast/text-to-video (may require allowlist)
 * - sora-2/text-to-video (may require allowlist)
 *
 * Audio language is configurable via args.audio_language (BCP-47 code,
 * e.g. "pt-BR", "en-US"). Defaults to pt-BR when omitted (business rule).
 *
 * NOTE: Higgsfield's official API (docs.higgsfield.ai) does NOT expose any
 * locale/language parameter — Veo 3, Sora 2 and Kling 2.6 only respond to
 * natural-language instructions inside the `prompt` itself. So this proxy
 * keeps the body strictly within the documented contract
 * (`prompt`, `image_url`, `aspect_ratio`, `resolution`, `duration`,
 * plus `with_audio` for models that support native audio) and prepends a
 * short, native-language audio directive to the prompt when audio is on.
 */

const HF_BASE = "https://platform.higgsfield.ai";

/** Traduz erros conhecidos da Higgsfield para mensagens claras em pt-BR. */
function friendlyError(status: number, data: any): string {
  const detail =
    (typeof data?.detail === "string" && data.detail) ||
    (typeof data?.error === "string" && data.error) ||
    (typeof data?.message === "string" && data.message) ||
    "";
  const code = detail.toLowerCase();

  if (code.includes("not_enough_credits") || code.includes("insufficient")) {
    return "Créditos da Higgsfield esgotados. Adicione créditos em platform.higgsfield.ai ou escolha um modelo mais econômico (Kling 3.0, DoP).";
  }
  if (status === 404 || code.includes("model not found") || code.includes("not_found")) {
    return "Modelo indisponível na sua conta Higgsfield. Modelos como Sora 2, Veo 3 e Seedance 2.0 exigem allowlist/upgrade. Use Kling 2.6/3.0, DoP ou Seedance 1.5.";
  }
  if (status === 401 || code.includes("unauthorized") || code.includes("invalid_api_key")) {
    return "Credenciais Higgsfield inválidas. Confira API ID e Secret em Configurações.";
  }
  if (status === 429 || code.includes("rate_limit")) {
    return "Limite de requisições atingido. Aguarde alguns segundos e tente novamente.";
  }
  if (code.includes("nsfw")) {
    return "Conteúdo bloqueado por moderação (NSFW). Ajuste o prompt.";
  }
  if (status >= 500) {
    return "Higgsfield está instável no momento (erro 500 no servidor da Higgsfield). Tente novamente em alguns segundos ou escolha outro modelo (ex.: Kling 3.0, Seedance 1.5, DoP).";
  }
  return detail || `Erro Higgsfield (HTTP ${status})`;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-higgsfield-api-id, x-higgsfield-api-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// deno-lint-ignore no-explicit-any
type Args = Record<string, any>;

// Remove um rótulo colado por engano no começo da credencial (ex.: o usuário
// cola "ID4a3d9079-..." ou "Secreta3b2..."). UUID/segredo são hex; nunca começam
// com as letras "id"/"secret", então strip do rótulo é seguro.
function cleanHfCred(v: string): string {
  // UUID/segredo são hex (nunca começam com 'i' ou 's'), então remover um
  // "id"/"secret" inicial colado é seguro mesmo sem separador.
  return v.trim().replace(/^(?:api\s*key\s*)?(?:id|secret)[\s:\-]*/i, "").trim();
}

function getAuthHeader(req: Request): string | null {
  const apiId = cleanHfCred(
    req.headers.get("x-higgsfield-api-id") || Deno.env.get("HIGGSFIELD_API_ID") || ""
  );
  const apiSecret = cleanHfCred(
    req.headers.get("x-higgsfield-api-secret") || Deno.env.get("HIGGSFIELD_API_SECRET") || ""
  );

  if (!apiId || !apiSecret) return null;
  return `Key ${apiId}:${apiSecret}`;
}

// ── Helpers ─────────────────────────────────────────────────
/** Map BCP-47 language codes to descriptive names the model can understand. */
const LANGUAGE_NAMES: Record<string, string> = {
  "pt-BR": "Brazilian Portuguese (português brasileiro), neutral Brazilian accent",
  "pt-PT": "European Portuguese (português de Portugal)",
  "en-US": "American English",
  "en-GB": "British English",
  "es-ES": "European Spanish (español de España)",
  "es-MX": "Latin American Spanish (español mexicano)",
  "fr-FR": "French (français)",
  "it-IT": "Italian (italiano)",
  "de-DE": "German (Deutsch)",
  "ja-JP": "Japanese (日本語)",
};

function describeLanguage(code: string): string {
  return LANGUAGE_NAMES[code] || code;
}

/**
 * Diretiva curta, em pt-BR, para garantir idioma do áudio nativo.
 * Inserida no início do `prompt` apenas quando with_audio=true.
 */
function buildAudioDirective(langCode: string): string {
  if (langCode.toLowerCase().startsWith("pt")) {
    return "[Áudio: o personagem fala em português brasileiro, com sotaque neutro do Brasil. Sem inglês.]";
  }
  const name = describeLanguage(langCode);
  return `[Audio: the character speaks in ${name}, native accent. No other language.]`;
}

function applyAudioFlags(body: Args, args: Args) {
  // A API oficial só reconhece `with_audio` (em modelos que suportam áudio nativo).
  // NÃO enviamos enable_audio / generate_audio / language / voice_language /
  // speech_language / locale / audio_language / audio_prompt — esses campos
  // não existem na API e podem confundir validações futuras.
  if (args.with_audio !== true) return;

  body.with_audio = true;

  const langCode =
    typeof args.audio_language === "string" && args.audio_language.trim()
      ? args.audio_language.trim()
      : "pt-BR";

  const directive = buildAudioDirective(langCode);
  const userAudioPrompt =
    typeof args.audio_prompt === "string" ? args.audio_prompt.trim() : "";
  const basePrompt = typeof body.prompt === "string" ? body.prompt : "";

  // Prefixa a diretiva no prompt principal — único canal que Veo/Sora/Kling 2.6
  // realmente usam para escolher o idioma do áudio nativo.
  const parts = [directive];
  if (userAudioPrompt) parts.push(`Narração: ${userAudioPrompt}`);
  if (basePrompt) parts.push(basePrompt);
  body.prompt = parts.join("\n\n");
}

function applyExtraVideoFields(body: Args, args: Args) {
  if (args.duration !== undefined) {
    const d = Number(args.duration);
    if (Number.isFinite(d) && d >= 1 && d <= 60) body.duration = d;
  }
  if (args.aspect_ratio) body.aspect_ratio = args.aspect_ratio;
  if (args.resolution) body.resolution = args.resolution;
  if (args.quality) body.quality = args.quality;
  if (args.style) body.style = args.style;
  if (args.motion_strength !== undefined) body.motion_strength = args.motion_strength;
  if (args.negative_prompt) body.negative_prompt = args.negative_prompt;
  if (args.seed !== undefined && args.seed !== "") body.seed = Number(args.seed);
  if (args.cfg_scale !== undefined) body.cfg_scale = args.cfg_scale;
  applyAudioFlags(body, args);
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
    const auth = getAuthHeader(req);
    if (!auth) {
      return new Response(
        JSON.stringify({ error: "Higgsfield API credentials não configuradas. Configure no Setup." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { tool, args = {} } = (await req.json()) as {
      tool: string;
      args?: Args;
    };

    if (!tool) {
      return new Response(
        JSON.stringify({ error: "Missing 'tool'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const headers: Record<string, string> = {
      "Authorization": auth,
      "Content-Type": "application/json",
      "Accept": "application/json",
    };

    // ── Text to Image ───────────────────────────────────────
    if (tool === "hf_text_to_image") {
      const model = args.model || "higgsfield-ai/soul/standard";
      const body: Args = {
        prompt: args.prompt || "",
        aspect_ratio: args.aspect_ratio || "9:16",
        resolution: args.resolution || "720p",
      };

      const res = await fetch(`${HF_BASE}/${model}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        return new Response(JSON.stringify({ error: friendlyError(res.status, data), code: data?.detail, details: data }), {
          status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify(data), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Text to Video Direct (Kling 2.6/3.0, Sora 2, Veo 3) ────
    if (tool === "hf_text_to_video_direct") {
      // Default = Kling 2.6 Pro (validado, áudio nativo, disponível na maioria das contas).
      const model = args.model || "kling-video/v2.6/pro/text-to-video";
      const body: Args = {
        prompt: args.prompt || "",
      };
      applyExtraVideoFields(body, args);
      if (args.fps) body.fps = args.fps;

      if (!body.prompt) {
        return new Response(JSON.stringify({ error: "Missing 'prompt'" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      console.log("[hf_text_to_video_direct]", model, JSON.stringify({
        ...body,
        prompt: typeof body.prompt === "string" && body.prompt.length > 200
          ? body.prompt.slice(0, 200) + "...<truncated>"
          : body.prompt,
        audio_prompt: typeof body.audio_prompt === "string" && body.audio_prompt.length > 200
          ? body.audio_prompt.slice(0, 200) + "...<truncated>"
          : body.audio_prompt,
      }));
      const res = await fetch(`${HF_BASE}/${model}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        return new Response(JSON.stringify({ error: friendlyError(res.status, data), code: data?.detail, details: data }), {
          status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify(data), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Image to Video ──────────────────────────────────────
    if (tool === "hf_image_to_video") {
      const model = args.model || "higgsfield-ai/dop/standard";
      const body: Args = {
        image_url: args.image_url || "",
        prompt: args.prompt || "",
      };
      applyExtraVideoFields(body, args);

      if (!body.image_url) {
        return new Response(JSON.stringify({ error: "Missing 'image_url'" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      console.log("[hf_image_to_video]", model, JSON.stringify({ ...body, image_url: "<url>" }));
      const res = await fetch(`${HF_BASE}/${model}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        return new Response(JSON.stringify({ error: friendlyError(res.status, data), code: data?.detail, details: data }), {
          status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify(data), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Text to Video (2-step: image then video) ────────────
    // Convenience: generates image from prompt, then animates it
    if (tool === "hf_text_to_video") {
      const imageModel = args.imageModel || "higgsfield-ai/soul/standard";
      const videoModel = args.videoModel || "higgsfield-ai/dop/standard";
      const prompt = args.prompt || "";
      const aspectRatio = args.aspect_ratio || "9:16";
      const duration = args.duration || 5;

      if (!prompt) {
        return new Response(JSON.stringify({ error: "Missing 'prompt'" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Step 1: Generate image
      const imgRes = await fetch(`${HF_BASE}/${imageModel}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          prompt,
          aspect_ratio: aspectRatio,
          resolution: "720p",
        }),
      });

      const imgData = await imgRes.json();
      if (!imgRes.ok) {
        return new Response(JSON.stringify({ error: imgData.error || `Image generation failed: ${imgRes.status}` }), {
          status: imgRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Return both step IDs — frontend polls image first, then creates video
      return new Response(JSON.stringify({
        step: "image",
        imageRequestId: imgData.request_id,
        imageStatusUrl: imgData.status_url,
        videoModel,
        prompt,
        duration,
        aspectRatio,
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Poll Status ─────────────────────────────────────────
    if (tool === "hf_status") {
      const requestId = args.request_id;
      if (!requestId) {
        return new Response(JSON.stringify({ error: "Missing 'request_id'" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const res = await fetch(`${HF_BASE}/requests/${requestId}/status`, { headers });
      const data = await res.json();

      return new Response(JSON.stringify(data), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Cancel Generation ───────────────────────────────────
    if (tool === "hf_cancel") {
      const requestId = args.request_id;
      if (!requestId) {
        return new Response(JSON.stringify({ error: "Missing 'request_id'" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const res = await fetch(`${HF_BASE}/requests/${requestId}/cancel`, {
        method: "POST",
        headers,
      });
      const data = await res.json().catch(() => ({ cancelled: true }));

      return new Response(JSON.stringify(data), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        error: `Unknown tool: ${tool}`,
        available: ["hf_text_to_image", "hf_text_to_video_direct", "hf_image_to_video", "hf_text_to_video", "hf_status", "hf_cancel"],
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("higgsfield-proxy error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
