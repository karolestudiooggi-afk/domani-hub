// Domani · hub-apagar-objeto
// Completa o "descolar": apaga um objeto do fundo usando a máscara (do SAM) e
// reconstrói o buraco, via finegrain-eraser da fal (mesma FAL_KEY).
// É o passo 2 que faltava — sem ele, a peça descolada vira "cópia".

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-fal-key, x-openai-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function falKey(req: Request): string {
  const key = req.headers.get("x-fal-key")?.trim() || Deno.env.get("FAL_KEY")?.trim();
  if (!key) throw new Error("Eraser não configurado. Defina o secret FAL_KEY no Supabase.");
  return key;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { imageUrl, maskUrl } = await req.json().catch(() => ({}));
    if (!imageUrl || !maskUrl) {
      return new Response(JSON.stringify({ error: "Informe imageUrl e maskUrl." }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const key = falKey(req);

    const resp = await fetch("https://fal.run/fal-ai/finegrain-eraser/mask", {
      method: "POST",
      headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: imageUrl, mask_url: maskUrl }),
    });
    if (!resp.ok) {
      const d = await resp.text().catch(() => "");
      const status = resp.status === 401 || resp.status === 403 ? 400 : 502;
      const msg = status === 400
        ? "A chave do fal.ai foi recusada. Confira o secret FAL_KEY."
        : `O eraser respondeu ${resp.status}. ${d.slice(0, 160)}`;
      return new Response(JSON.stringify({ error: msg }), {
        status, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const data = await resp.json();
    const url = data?.image?.url;
    if (!url) throw new Error("O eraser não devolveu imagem.");

    return new Response(JSON.stringify({ imageUrl: url }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro ao apagar do fundo" }), {
      status: 502, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
