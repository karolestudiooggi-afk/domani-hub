/**
 * RECORTE EM CAMADAS
 *
 * O servidor devolve máscaras (uma imagem por objeto). Aqui usamos cada máscara
 * para recortar a imagem original em um PNG transparente — que vira uma camada
 * móvel no canvas. Tudo acontece no navegador.
 *
 * Robustez:
 *  - Carregamos as imagens como BLOB (mesma origem via blob:) para o canvas não
 *    "sujar" (tainted) e o toDataURL/getImageData funcionarem mesmo com imagens
 *    de outro domínio (fal.media, storage). Se o fetch falhar, caímos para
 *    crossOrigin.
 *  - Aceitamos os dois formatos de máscara: preto-e-branco (luminância) e recorte
 *    com canal alfa. Detectamos qual é automaticamente.
 */

export type Camada = {
  /** PNG transparente, em data URL. */
  src: string;
  /** Posição e tamanho do recorte na imagem original (px). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** URL da máscara usada — necessária para depois apagar a peça do fundo. */
  maskUrl: string;
};

/** Carrega direto de uma URL/objectURL/data URL. */
function carregarDireto(src: string, cors = false): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Não consegui carregar a imagem."));
    img.src = src;
  });
}

/**
 * Carrega uma imagem SEM sujar o canvas. Baixa como blob e usa uma blob: URL
 * (mesma origem), o que evita o problema de CORS ao ler os pixels depois.
 * Se o download falhar, tenta o modo crossOrigin como plano B.
 */
async function carregar(src: string): Promise<HTMLImageElement> {
  if (src.startsWith("data:") || src.startsWith("blob:")) {
    return carregarDireto(src);
  }
  try {
    const resp = await fetch(src, { mode: "cors" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    try {
      return await carregarDireto(url);
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  } catch {
    return carregarDireto(src, true);
  }
}

/**
 * Converte a máscara em canal alfa (opaco = dentro do objeto, transparente = fora)
 * e devolve a caixa que envolve o objeto, para cortarmos só o pedaço útil.
 *
 * Detecta o formato: se a máscara já tem transparência relevante, usamos o alfa;
 * senão, usamos luminância (branco = dentro, no fundo preto).
 */
function mascaraParaAlfa(mask: HTMLImageElement, w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas indisponível.");

  ctx.drawImage(mask, 0, 0, w, h);
  const dados = ctx.getImageData(0, 0, w, h);
  const px = dados.data;
  const total = px.length / 4;

  // Quanta transparência a máscara já tem? Muita => é um recorte por alfa.
  let transp = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] < 200) transp++;
  const usaAlfa = transp > total * 0.02 && transp < total * 0.98;

  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let i = 0; i < px.length; i += 4) {
    const dentro = usaAlfa
      ? px[i + 3] > 127
      : (px[i] + px[i + 1] + px[i + 2]) / 3 > 127;
    px[i + 3] = dentro ? 255 : 0;
    if (dentro) {
      const p = i / 4;
      const x = p % w, y = (p / w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  ctx.putImageData(dados, 0, 0);
  if (maxX < 0) return null; // máscara vazia
  return { canvas: c, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Recorta a imagem original em camadas, uma por máscara.
 * Máscaras muito pequenas (fragmentos) ou que pegam a imagem quase inteira
 * são descartadas.
 */
export async function recortarCamadas(
  imagemUrl: string,
  mascarasUrls: string[],
  opcoes: { areaMinimaPct?: number } = {},
): Promise<Camada[]> {
  const { areaMinimaPct = 1.0 } = opcoes;

  const original = await carregar(imagemUrl);
  const W = original.naturalWidth, H = original.naturalHeight;
  const areaTotal = W * H;

  const camadas: Camada[] = [];
  let ok = 0, vazias = 0, fora = 0, erros = 0;

  for (const url of mascarasUrls) {
    try {
      const mask = await carregar(url);
      const alfa = mascaraParaAlfa(mask, W, H);
      if (!alfa) { vazias++; continue; }

      const pct = ((alfa.w * alfa.h) / areaTotal) * 100;
      if (pct < areaMinimaPct || pct > 97) { fora++; continue; }

      const out = document.createElement("canvas");
      out.width = alfa.w; out.height = alfa.h;
      const octx = out.getContext("2d");
      if (!octx) { erros++; continue; }

      octx.drawImage(original, alfa.x, alfa.y, alfa.w, alfa.h, 0, 0, alfa.w, alfa.h);
      octx.globalCompositeOperation = "destination-in";
      octx.drawImage(alfa.canvas, alfa.x, alfa.y, alfa.w, alfa.h, 0, 0, alfa.w, alfa.h);

      camadas.push({
        src: out.toDataURL("image/png"),
        x: alfa.x, y: alfa.y, w: alfa.w, h: alfa.h,
        maskUrl: url,
      });
      ok++;
    } catch {
      erros++;
      continue;
    }
  }

  // Diagnóstico: aparece no Console (F12) para sabermos o que aconteceu.
  console.log(
    `[camadas] máscaras=${mascarasUrls.length} recortadas=${ok} vazias=${vazias} fora_de_faixa=${fora} erros=${erros}`,
  );

  // Maiores primeiro.
  return camadas.sort((a, b) => b.w * b.h - a.w * a.h);
}

/**
 * Garante uma URL pública para a imagem. O serviço de separação precisa BAIXAR
 * a imagem — então data URLs (base64) são enviadas ao storage antes.
 */
export async function urlPublica(src: string): Promise<string> {
  if (!src.startsWith("data:")) return src;

  const { supabase } = await import("@/integrations/supabase/client");
  const { uuid } = await import("@/lib/uuid");

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada. Faça login novamente.");

  const [head, b64] = src.split(",");
  const mime = /:(.*?);/.exec(head)?.[1] || "image/png";
  const ext = mime.split("/")[1] || "png";

  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  const path = `${user.id}/camadas/${uuid()}.${ext}`;
  const { error } = await supabase.storage
    .from("media")
    .upload(path, bytes, { contentType: mime });
  if (error) throw new Error(`Não consegui preparar a imagem: ${error.message}`);

  return supabase.storage.from("media").getPublicUrl(path).data.publicUrl;
}
