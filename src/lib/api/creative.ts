/**
 * Criativo em CAMADAS (generate-creative).
 *
 * A edge function devolve o anúncio já separado em camadas (fundo, formas,
 * textos, foto sem texto). Aqui chamamos a função e convertemos esse JSON
 * (coordenadas 1080x1350) nos elementos do canvas (360x450), que já são
 * editáveis nativamente — texto de verdade, cor, arrastar, etc.
 *
 * A foto de fundo vem sem texto (image_prompt) e é gerada pelo gpt-image-1,
 * mantendo o texto por cima como camada editável.
 */

import { getSupabaseUrl, baseHeaders } from "./_shared";
import { generateOpenAiImage } from "./openai";
import { CANVAS_W, CANVAS_H, uid, type El, type Slide } from "@/components/studio/workspace/types";

export interface CreativeLayer {
  type: "rect" | "text" | "image";
  name?: string;
  x: number; y: number; w: number; h: number;
  // rect
  fill?: string; grad?: string; radius?: number;
  // text
  text?: string; size?: number; weight?: number;
  color?: string; align?: "left" | "center" | "right"; lh?: number;
  // image
  src?: string; image_prompt?: string;
}

export interface CreativeDoc {
  width: number;
  height: number;
  layers: CreativeLayer[];
  source?: string;
  note?: string;
}

/** Chama a edge function generate-creative (gpt-4o → criativo em camadas). */
export async function generateCreative(prompt: string): Promise<CreativeDoc> {
  let res: Response;
  try {
    res = await fetch(`${getSupabaseUrl()}/functions/v1/generate-creative`, {
      method: "POST",
      headers: await baseHeaders(),
      body: JSON.stringify({ prompt }),
    });
  } catch {
    throw new Error(
      "Não consegui falar com o servidor. A função generate-creative pode não " +
      "estar publicada. Rode: supabase functions deploy generate-creative",
    );
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const e = await res.json(); msg = e.error || msg; } catch { /* */ }
    if (res.status === 404) {
      msg = "Função generate-creative não encontrada. Rode: supabase functions deploy generate-creative";
    }
    throw new Error(msg);
  }
  return res.json();
}

/**
 * Gera o criativo em camadas e devolve um Slide pronto para o canvas — já com
 * a foto de fundo (sem texto) gerada e os textos como camadas editáveis.
 */
export async function gerarCriativoEmCamadas(prompt: string): Promise<Slide> {
  const doc = await generateCreative(prompt);

  const kx = CANVAS_W / (doc.width || 1080);
  const ky = CANVAS_H / (doc.height || 1350);

  const els: El[] = [];
  let bg = "#111111";
  const jobsFoto: { idx: number; prompt: string }[] = [];

  (doc.layers || []).forEach((L, i) => {
    const x = Math.round(L.x * kx), y = Math.round(L.y * ky);
    const w = Math.max(4, Math.round(L.w * kx)), h = Math.max(4, Math.round(L.h * ky));

    if (L.type === "rect") {
      const fill = L.grad
        ? `linear-gradient(135deg, ${L.fill || "#000000"}, ${L.grad})`
        : (L.fill || "#000000");
      // Um rect que cobre tudo (e é o primeiro) vira o fundo do slide.
      const cobreTudo =
        L.x <= 0 && L.y <= 0 &&
        L.w >= (doc.width || 1080) * 0.98 &&
        L.h >= (doc.height || 1350) * 0.98;
      if (cobreTudo && i === 0) { bg = fill; return; }
      els.push({ id: uid(), type: "shape", x, y, w, h, bg: fill, radius: Math.round((L.radius || 0) * kx), opacity: 1 });
    } else if (L.type === "text") {
      els.push({
        id: uid(), type: "text", x, y, w, h,
        text: L.text || "",
        fontSize: Math.max(8, Math.round((L.size || 40) * kx)),
        color: L.color || "#ffffff",
        weight: L.weight || 600,
        align: L.align || "left",
        lineHeight: L.lh || 1.15,
      });
    } else if (L.type === "image") {
      const el: El = { id: uid(), type: "image", x, y, w, h, src: L.src || "", radius: Math.round((L.radius || 0) * kx) };
      if (!el.src && L.image_prompt?.trim()) {
        jobsFoto.push({ idx: els.length, prompt: L.image_prompt.trim() });
      }
      els.push(el);
    }
  });

  // Gera as fotos (sem texto) em paralelo. Se alguma falhar, fica o placeholder.
  await Promise.all(
    jobsFoto.map(async (j) => {
      try {
        const { images } = await generateOpenAiImage({
          prompt: j.prompt, size: "1024x1536", quality: "medium", n: 1,
        });
        if (images?.[0]) els[j.idx].src = images[0];
      } catch { /* mantém placeholder */ }
    }),
  );

  return { bg, els };
}

// ─────────────────────────────────────────────────────────────────────────
// ARTE COMPLETA (nível ChatGPT): gpt-4o dirige + Ideogram gera o post inteiro,
// com o texto JÁ dentro da imagem. Não é editável — é a opção "IA faz tudo".
// ─────────────────────────────────────────────────────────────────────────

export interface PosterBrand { name?: string; colors?: string[]; tone?: string; typography?: string }

export interface PosterResult { imageUrl: string; prompt: string }

/** Chama a edge function hub-poster e devolve a URL da arte gerada. */
export async function gerarArtePoster(
  brief: string,
  brand?: PosterBrand,
  aspect = "3:4",
): Promise<PosterResult> {
  let res: Response;
  try {
    res = await fetch(`${getSupabaseUrl()}/functions/v1/hub-poster`, {
      method: "POST",
      headers: await baseHeaders(),
      body: JSON.stringify({ brief, brand, aspect }),
    });
  } catch {
    throw new Error(
      "Não consegui falar com o servidor. A função hub-poster pode não estar publicada.",
    );
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const e = await res.json(); msg = e.error || msg; } catch { /* */ }
    throw new Error(msg);
  }
  return res.json();
}

/** Gera a arte e devolve um Slide pronto (a imagem é o fundo; sem camadas). */
export async function gerarArtePosterSlide(brief: string, brand?: PosterBrand): Promise<Slide> {
  const { imageUrl } = await gerarArtePoster(brief, brand);
  return { bg: "#111111", bgImage: imageUrl, els: [] };
}

// ─────────────────────────────────────────────────────────────────────────
// SOLTAR DO FUNDO: apaga uma peça descolada do fundo e reconstrói o buraco
// (finegrain-eraser da fal, via hub-apagar-objeto). Completa o "descolar".
// ─────────────────────────────────────────────────────────────────────────

/** Apaga um objeto do fundo usando a máscara; devolve a nova URL do fundo. */
export async function apagarObjeto(imageUrl: string, maskUrl: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${getSupabaseUrl()}/functions/v1/hub-apagar-objeto`, {
      method: "POST",
      headers: await baseHeaders(),
      body: JSON.stringify({ imageUrl, maskUrl }),
    });
  } catch {
    throw new Error("Não consegui falar com o servidor (hub-apagar-objeto).");
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const e = await res.json(); msg = e.error || msg; } catch { /* */ }
    throw new Error(msg);
  }
  const data = await res.json();
  if (!data?.imageUrl) throw new Error("O eraser não devolveu imagem.");
  return data.imageUrl as string;
}
