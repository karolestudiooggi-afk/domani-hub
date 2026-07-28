// Domani · generate-creative
// Gera um criativo EM CAMADAS (não uma imagem chapada): fundo, formas, textos.
// Texto sempre volta como camada editável -> as camadas já nascem "descoladas".
// Usa OpenAI (gpt-4o) via secret OPENAI_API_KEY ou header x-openai-api-key.
// Sem chave -> devolve um mock, para o app não quebrar.

const cors = {
  "Access-Control-Allow-Origin": "*",
  // Alinhado com as outras funções do app: aceita o JWT do usuário + as chaves
  // de painel. Sem isso, a chamada autenticada do front era barrada no preflight.
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-openai-api-key, x-pfm-api-key, x-pexels-api-key, x-apify-api-token, x-firecrawl-api-key, x-higgsfield-api-id, x-higgsfield-api-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SCHEMA_HINT = `Responda APENAS com JSON no formato:
{"width":1080,"height":1350,"layers":[
  {"type":"rect","name":"Fundo","x":0,"y":0,"w":1080,"h":1350,"fill":"#hex","grad":"#hex","radius":0},
  {"type":"image","name":"Foto","x":,"y":,"w":,"h":,"src":"","image_prompt":"descrição da foto SEM texto"},
  {"type":"text","name":"Headline","x":,"y":,"w":,"h":,"text":"...","size":,"weight":800,"color":"#hex","align":"left","lh":1.02},
  {"type":"rect","name":"Botão CTA",...},
  {"type":"text","name":"Texto do CTA",...}
]}
Regras: NUNCA escreva texto dentro da imagem (image_prompt sem palavras). Todo texto é camada 'text'. Coordenadas dentro de 1080x1350. Ordem = z-index (primeiro = fundo).`;

async function withOpenAI(prompt: string, key: string) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Você é diretor de arte. Monta anúncios em CAMADAS editáveis. " + SCHEMA_HINT },
        { role: "user", content: `Briefing do anúncio: ${prompt}` },
      ],
      temperature: 0.7,
    }),
  });
  if (!r.ok) throw new Error("openai " + r.status);
  const j = await r.json();
  return JSON.parse(j.choices[0].message.content);
}

function mock(prompt: string) {
  const head = (prompt || "Seu anúncio aqui").slice(0, 46);
  return {
    width: 1080, height: 1350, source: "mock",
    layers: [
      { type: "rect", name: "Fundo", x: 0, y: 0, w: 1080, h: 1350, fill: "#e85d1f", grad: "#b83c0c", radius: 0 },
      { type: "rect", name: "Faixa creme", x: 0, y: 800, w: 1080, h: 550, fill: "#f3e4cf", radius: 0 },
      { type: "image", name: "Foto (sem texto)", x: 110, y: 250, w: 860, h: 620, src: "", image_prompt: prompt },
      { type: "text", name: "Headline", x: 90, y: 80, w: 900, h: 180, text: head, size: 92, weight: 800, color: "#fff6ec", align: "left", lh: 1.02 },
      { type: "text", name: "Subtexto", x: 90, y: 980, w: 780, h: 100, text: "Edite este texto — ele é uma camada.", size: 38, weight: 500, color: "#7a3b16", align: "left" },
      { type: "rect", name: "Botão CTA", x: 90, y: 1120, w: 440, h: 112, fill: "#1f140c", radius: 60 },
      { type: "text", name: "Texto do CTA", x: 90, y: 1153, w: 440, h: 60, text: "Saiba mais", size: 38, weight: 700, color: "#ffd9a8", align: "center" },
    ],
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { prompt } = await req.json().catch(() => ({ prompt: "" }));
    // Chave do painel (header) tem prioridade; depois o secret do servidor.
    const key = req.headers.get("x-openai-api-key")?.trim() || Deno.env.get("OPENAI_API_KEY");
    let doc;
    if (key) {
      try { doc = await withOpenAI(prompt ?? "", key); doc.source = "gpt-4o"; }
      catch (_e) { doc = mock(prompt ?? ""); doc.note = "openai_failed_fell_back_to_mock"; }
    } else {
      doc = mock(prompt ?? "");
      doc.note = "set OPENAI_API_KEY secret to enable GPT";
    }
    return new Response(JSON.stringify(doc), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
