// Domani · hub-poster
// Gera uma ARTE DE MARKETING COMPLETA (texto já dentro da imagem), nível ChatGPT.
//  1) gpt-4o vira DIRETOR DE ARTE e escreve um prompt caprichado (OPENAI_API_KEY)
//  2) Ideogram v3 na fal gera a arte com o texto renderizado bonito (FAL_KEY)
// As duas chaves já existem no projeto. O texto NÃO fica editável (é baked) —
// é a troca da opção "nível ChatGPT".

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-openai-api-key, x-fal-key, x-pfm-api-key, x-pexels-api-key, x-apify-api-token, x-firecrawl-api-key, x-higgsfield-api-id, x-higgsfield-api-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Brand { name?: string; colors?: string[]; tone?: string; typography?: string }

async function diretorDeArte(brief: string, brand: Brand | undefined, key: string): Promise<string> {
  const ctx = brand
    ? `Marca: ${brand.name || "—"}. Paleta de cores OBRIGATÓRIA (use exatamente estas): ${(brand.colors || []).join(", ") || "livre"}. Tipografia da marca (imite este estilo de fonte): ${brand.typography || "livre"}. Tom: ${brand.tone || "—"}.`
    : "";
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "Você é diretor de arte sênior de anúncios para redes sociais. A partir de um briefing, escreva UM único prompt de geração de imagem, em INGLÊS, para um post de Instagram profissional e impactante (scroll-stopping). A arte DEVE conter o texto principal (headline e, se fizer sentido, um CTA curto) renderizado de forma bonita e legível — mantenha esse texto EXATAMENTE no idioma do briefing (português), escrito entre aspas no prompt. REGRA CRÍTICA: quando a marca informar paleta de cores e tipografia, você é OBRIGADO a respeitá-las — use exatamente as cores da marca como paleta dominante e descreva a tipografia no estilo das fontes da marca. Descreva composição, sujeito, iluminação, a paleta de cores da marca, o estilo tipográfico e o clima. Nada de marca d'água ou texto embolado. Máximo 130 palavras. Responda APENAS com o prompt, sem preâmbulo.",
        },
        { role: "user", content: `Briefing: ${brief}\n${ctx}` },
      ],
      temperature: 0.8,
    }),
  });
  if (!r.ok) throw new Error(`openai ${r.status}`);
  const j = await r.json();
  return String(j.choices?.[0]?.message?.content || brief).trim();
}

async function ideogram(prompt: string, aspect: string, key: string): Promise<string> {
  const resp = await fetch("https://fal.run/fal-ai/ideogram/v3", {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      aspect_ratio: aspect || "3:4",
      rendering_speed: "QUALITY",
      expand_prompt: false,
      num_images: 1,
    }),
  });
  if (!resp.ok) {
    const d = await resp.text().catch(() => "");
    if (resp.status === 401 || resp.status === 403) {
      throw new Error("A chave do fal.ai foi recusada. Confira o secret FAL_KEY.");
    }
    throw new Error(`O gerador de imagem respondeu ${resp.status}. ${d.slice(0, 160)}`);
  }
  const data = await resp.json();
  const url = data?.images?.[0]?.url;
  if (!url) throw new Error("O gerador não devolveu imagem.");
  return url;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { brief, brand, aspect } = await req.json().catch(() => ({ brief: "" }));
    if (!brief || !String(brief).trim()) {
      return new Response(JSON.stringify({ error: "Descreva o que você quer criar." }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const openaiKey = req.headers.get("x-openai-api-key")?.trim() || Deno.env.get("OPENAI_API_KEY");
    const falKey = req.headers.get("x-fal-key")?.trim() || Deno.env.get("FAL_KEY");
    if (!falKey) {
      return new Response(JSON.stringify({ error: "Gerador de imagem não configurado. Defina o secret FAL_KEY no Supabase." }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Se não houver OpenAI, usa o próprio briefing como prompt (fallback).
    const prompt = openaiKey
      ? await diretorDeArte(String(brief).trim(), brand as Brand | undefined, openaiKey).catch(() => String(brief).trim())
      : String(brief).trim();

    const imageUrl = await ideogram(prompt, String(aspect || "3:4"), falKey);

    return new Response(JSON.stringify({ imageUrl, prompt }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro ao gerar a arte" }), {
      status: 502, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
