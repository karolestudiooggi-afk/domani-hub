/**
 * RECORTE EM CAMADAS
 *
 * O servidor devolve máscaras (imagens em preto e branco, onde o branco marca
 * o objeto). Aqui usamos cada máscara para recortar a imagem original em um
 * PNG transparente — que vira uma camada móvel no canvas.
 *
 * Tudo acontece no navegador: nada é enviado de volta ao servidor.
 */

export type Camada = {
  /** PNG transparente, em data URL. */
  src: string;
  /** Posição e tamanho do recorte na imagem original (px). */
  x: number;
  y: number;
  w: number;
  h: number;
};

/** Carrega uma imagem respeitando CORS (para poder ler os pixels depois). */
function carregar(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Não consegui carregar a imagem."));
    img.src = src;
  });
}

/**
 * Converte a máscara (preto e branco) em canal alfa: branco vira opaco,
 * preto vira transparente. É isso que permite usar a máscara como recorte.
 * Devolve também a área ocupada, para cortarmos só o pedaço útil.
 */
function mascaraParaAlfa(mask: HTMLImageElement, w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível.");

  ctx.drawImage(mask, 0, 0, w, h);
  const dados = ctx.getImageData(0, 0, w, h);
  const px = dados.data;

  let minX = w, minY = h, maxX = -1, maxY = -1;

  for (let i = 0; i < px.length; i += 4) {
    // Luminância decide: claro = dentro do objeto, escuro = fora.
    const lum = (px[i] + px[i + 1] + px[i + 2]) / 3;
    const dentro = lum > 127;
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
 * Máscaras muito pequenas (fragmentos) são descartadas.
 */
export async function recortarCamadas(
  imagemUrl: string,
  mascarasUrls: string[],
  opcoes: { areaMinimaPct?: number } = {},
): Promise<Camada[]> {
  const { areaMinimaPct = 1.5 } = opcoes;

  const original = await carregar(imagemUrl);
  const W = original.naturalWidth, H = original.naturalHeight;
  const areaTotal = W * H;

  const camadas: Camada[] = [];

  for (const url of mascarasUrls) {
    try {
      const mask = await carregar(url);
      const alfa = mascaraParaAlfa(mask, W, H);
      if (!alfa) continue;

      // Descarta fragmentos e máscaras que pegam a imagem quase inteira
      // (essas não separam nada — são a própria foto).
      const pct = ((alfa.w * alfa.h) / areaTotal) * 100;
      if (pct < areaMinimaPct || pct > 92) continue;

      // Recorta: desenha a original e usa a máscara como alfa.
      const out = document.createElement("canvas");
      out.width = alfa.w; out.height = alfa.h;
      const octx = out.getContext("2d");
      if (!octx) continue;

      octx.drawImage(original, alfa.x, alfa.y, alfa.w, alfa.h, 0, 0, alfa.w, alfa.h);
      octx.globalCompositeOperation = "destination-in";
      octx.drawImage(alfa.canvas, alfa.x, alfa.y, alfa.w, alfa.h, 0, 0, alfa.w, alfa.h);

      camadas.push({
        src: out.toDataURL("image/png"),
        x: alfa.x, y: alfa.y, w: alfa.w, h: alfa.h,
      });
    } catch {
      // Uma máscara com problema não pode derrubar as outras.
      continue;
    }
  }

  // Maiores primeiro: as camadas relevantes aparecem no topo da lista.
  return camadas.sort((a, b) => b.w * b.h - a.w * a.h);
}

/**
 * Garante uma URL pública para a imagem.
 * O serviço de separação precisa BAIXAR a imagem — então data URLs (base64,
 * que só existem no navegador) precisam ser enviadas ao storage antes.
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
