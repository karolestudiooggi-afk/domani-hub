import { supabase } from "@/integrations/supabase/client";
import { uuid } from "@/lib/uuid";

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(",");
  const mime = head.match(/data:(.*?);/)?.[1] || "image/png";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Abre a arte no editor do Canva.
 * Recebe as imagens da criação (data: ou http), garante uma URL pública
 * (sobe pro storage se precisar), pede a autorização do Canva via canva-start
 * e redireciona o navegador — o callback canva-oauth cria o design e abre o editor.
 */
export async function abrirNoCanva(images: string[], title = "Domani design"): Promise<void> {
  let imageUrl = images.find((u) => !!u);
  if (!imageUrl) throw new Error("Sem imagem para enviar ao Canva.");

  if (imageUrl.startsWith("data:")) {
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user) throw new Error("Faça login para usar o Canva.");
    const blob = dataUrlToBlob(imageUrl);
    const path = `${user.id}/canva/cv_${uuid()}.png`;
    const { error } = await supabase.storage.from("media").upload(path, blob, { contentType: "image/png" });
    if (error) throw error;
    imageUrl = supabase.storage.from("media").getPublicUrl(path).data.publicUrl;
  }

  const { data, error } = await supabase.functions.invoke("canva-start", {
    body: { imageUrl, title: (title || "Domani design").slice(0, 50) },
  });
  if (error) throw error;
  if (!data?.url) throw new Error("Não consegui iniciar o Canva.");
  window.location.href = data.url;
}
