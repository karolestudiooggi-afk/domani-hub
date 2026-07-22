/**
 * Higgsfield image & video generation via the higgsfield-proxy Edge Function.
 */

import { getSupabaseUrl, getSavedConfig, baseHeaders } from "./_shared";

export interface HfGenerationResult {
  status: string;
  request_id: string;
  status_url: string;
  cancel_url: string;
}

export interface HfStatusResult {
  status: "queued" | "in_progress" | "completed" | "failed" | "nsfw";
  request_id: string;
  video?: { url: string };
  images?: { url: string }[];
  error?: string;
}

export async function callHiggsfield(
  tool: string,
  args: Record<string, unknown> = {}
): Promise<unknown> {
  const url = `${getSupabaseUrl()}/functions/v1/hub-higgsfield-proxy`;
  const cfg = getSavedConfig();
  const headers = await baseHeaders();
  if (cfg.higgsFieldApiId) headers["x-higgsfield-api-id"] = cfg.higgsFieldApiId;
  if (cfg.higgsFieldApiSecret) headers["x-higgsfield-api-secret"] = cfg.higgsFieldApiSecret;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ tool, args }),
  });

  if (!res.ok) {
    let errorMsg: string;
    try { const e = await res.json(); errorMsg = e.error || `HTTP ${res.status}`; }
    catch { errorMsg = `HTTP ${res.status}`; }
    throw new Error(errorMsg);
  }

  return res.json();
}

/** Generate image from text prompt */
export async function hfTextToImage(prompt: string, opts?: {
  model?: string; aspect_ratio?: string; resolution?: string;
}): Promise<HfGenerationResult> {
  return callHiggsfield("hf_text_to_image", { prompt, ...opts }) as Promise<HfGenerationResult>;
}

/** Generate video from image URL */
export async function hfImageToVideo(imageUrl: string, prompt: string, opts?: {
  model?: string; duration?: number; aspect_ratio?: string;
  resolution?: string; quality?: string;
  with_audio?: boolean; audio_prompt?: string;
  negative_prompt?: string; seed?: number; cfg_scale?: number;
  motion_strength?: number; style?: string;
}): Promise<HfGenerationResult> {
  return callHiggsfield("hf_image_to_video", {
    image_url: imageUrl, prompt, ...opts,
  }) as Promise<HfGenerationResult>;
}

/** Text-to-video (2-step: generates image then animates) */
export async function hfTextToVideo(prompt: string, opts?: {
  imageModel?: string; videoModel?: string; aspect_ratio?: string; duration?: number;
}): Promise<{ step: string; imageRequestId: string; videoModel: string; prompt: string }> {
  return callHiggsfield("hf_text_to_video", { prompt, ...opts }) as Promise<any>;
}

/** Poll generation status */
export async function hfStatus(requestId: string): Promise<HfStatusResult> {
  return callHiggsfield("hf_status", { request_id: requestId }) as Promise<HfStatusResult>;
}

/** Cancel a generation */
export async function hfCancel(requestId: string): Promise<void> {
  await callHiggsfield("hf_cancel", { request_id: requestId });
}

/** Validate Higgsfield credentials */
export async function validateHiggsFieldKey(apiId: string, apiSecret: string): Promise<{ valid: boolean; error?: string }> {
  // Valida via nosso proxy (sem CORS). Faz um hf_status com request_id inválido:
  // - 401/Unauthorized → credenciais ruins
  // - 404/Not found → credenciais OK (apenas o request_id não existe)
  if (!apiId.trim() || !apiSecret.trim()) {
    return { valid: false, error: "Informe API ID e Secret" };
  }
  try {
    const url = `${getSupabaseUrl()}/functions/v1/hub-higgsfield-proxy`;
    const headers = await baseHeaders();
    headers["x-higgsfield-api-id"] = apiId;
    headers["x-higgsfield-api-secret"] = apiSecret;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ tool: "hf_status", args: { request_id: "00000000-0000-0000-0000-000000000000" } }),
    });
    if (res.ok) return { valid: true };
    const data = await res.json().catch(() => ({} as { error?: string }));
    const msg = (data?.error || "").toString().toLowerCase();
    if (res.status === 401 || msg.includes("inválidas") || msg.includes("unauthorized")) {
      return { valid: false, error: "Credenciais inválidas" };
    }
    // Qualquer outro erro (ex.: 404 do request_id inexistente) significa que as
    // credenciais foram aceitas pela Higgsfield.
    return { valid: true };
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : "Erro de conexão" };
  }
}
