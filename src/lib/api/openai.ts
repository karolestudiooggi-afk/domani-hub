/**
 * OpenAI image generation via the openai-image Edge Function.
 * A chave OpenAI é resolvida no servidor (Supabase Vault) — o cliente nunca a vê.
 */

import { getSupabaseUrl, baseHeaders } from "./_shared";

export interface OpenAiImageParams {
  prompt: string;
  size?: "1024x1024" | "1024x1536" | "1536x1024" | "auto";
  n?: number;
  model?: string;
  quality?: "low" | "medium" | "high" | "auto";
  background?: "transparent" | "opaque" | "auto";
  /**
   * Foto de referência enviada pelo usuário (data URL). Quando informada, a
   * IA parte dessa imagem em vez de criar do zero.
   */
  referenceImage?: string;
}

export interface OpenAiImageResult {
  images: string[]; // data URLs (base64) ou URLs
  model: string;
}

export async function generateOpenAiImage(params: OpenAiImageParams): Promise<OpenAiImageResult> {
  const url = `${getSupabaseUrl()}/functions/v1/hub-openai-image`;
  const headers = await baseHeaders();

  let response: Response;
  try {
    response = await fetch(url, { method: "POST", headers, body: JSON.stringify(params) });
  } catch {
    throw new Error(
      "Não foi possível falar com o servidor de geração. As Edge Functions " +
      "podem não estar publicadas. Rode: supabase functions deploy",
    );
  }

  if (!response.ok) {
    let msg: string;
    try { const e = await response.json(); msg = e.error || `HTTP ${response.status}`; }
    catch { msg = `HTTP ${response.status}`; }
    if (response.status === 404) {
      msg = "Função de geração não encontrada no servidor. Rode: supabase functions deploy";
    }
    throw new Error(msg);
  }

  return response.json();
}

// ─── Separação de camadas (SAM via fal.ai) ───────────────────────────

export interface SepararCamadasParams {
  /** URL pública da imagem — o serviço precisa conseguir baixá-la. */
  imageUrl: string;
  /** O que separar ("pizza", "pessoa"). Vazio = automático. */
  alvo?: string;
}

/**
 * Pede ao servidor as máscaras dos objetos de uma imagem.
 * O recorte em si é feito no navegador (ver src/lib/camadas.ts).
 */
export async function separarCamadas(
  params: SepararCamadasParams,
): Promise<{ mascaras: string[] }> {
  const url = `${getSupabaseUrl()}/functions/v1/hub-separar-camadas`;
  const headers = await baseHeaders();

  let response: Response;
  try {
    response = await fetch(url, { method: "POST", headers, body: JSON.stringify(params) });
  } catch {
    throw new Error(
      "Não foi possível falar com o servidor. A função pode não estar publicada — rode: supabase functions deploy",
    );
  }

  if (!response.ok) {
    let msg: string;
    try { const e = await response.json(); msg = e.error || `HTTP ${response.status}`; }
    catch { msg = `HTTP ${response.status}`; }
    throw new Error(msg);
  }

  return response.json();
}
