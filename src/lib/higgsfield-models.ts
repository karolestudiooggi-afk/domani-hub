/**
 * Catálogo de modelos de vídeo Higgsfield disponíveis no proxy.
 * Define durações suportadas, resoluções, suporte a áudio nativo
 * e qualidade — usado pela UI de Create Visual para montar selects
 * coerentes e por validação opcional.
 */

export type HfModelKind = "text-to-video" | "image-to-video";

export interface HfVideoModel {
  id: string;                  // model_id usado no endpoint POST /{id}
  label: string;               // texto exibido no select
  family: string;              // agrupamento (Veo, Sora, Kling, Seedance, Wan, DoP)
  kind: HfModelKind;
  durations: number[];         // segundos suportados
  resolutions?: string[];      // ex: ["720p","1080p"]; omit = não exibir
  qualities?: string[];        // ex: ["basic","high"]; omit = não exibir
  supportsAudio: boolean;      // mostra toggle "Gerar áudio"
  defaultAudio?: boolean;      // default do toggle (true se suportado)
  ptbrSpeech?: boolean;        // o TTS do modelo FALA português brasileiro (Kling não: só en/zh/ja/ko/es)
  description?: string;
}

export const HF_VIDEO_MODELS: HfVideoModel[] = [
  {
    id: "kling-video/v2.6/pro/text-to-video",
    label: "Kling 2.6 Pro — Texto→Vídeo (com áudio)",
    family: "Kling",
    kind: "text-to-video",
    durations: [5, 10],
    supportsAudio: true,
    defaultAudio: true,
    ptbrSpeech: false,
    description: "Bom custo-benefício, disponível na maioria das contas. ⚠️ A fala do Kling sai em inglês/espanhol — o TTS NÃO fala português.",
  },
  {
    id: "kling-video/v3.0/pro/text-to-video",
    label: "Kling 3.0 Pro — Texto→Vídeo (com áudio)",
    family: "Kling",
    kind: "text-to-video",
    durations: [5, 10],
    supportsAudio: true,
    defaultAudio: true,
    ptbrSpeech: false,
    description: "Geração mais recente da Kling, qualidade superior. ⚠️ A fala sai em inglês/espanhol — o TTS NÃO fala português.",
  },
  {
    id: "sora-2/text-to-video",
    label: "Sora 2 — Texto→Vídeo (fala em pt-BR)",
    family: "Sora",
    kind: "text-to-video",
    durations: [4, 8, 12],
    resolutions: ["720p", "1080p"],
    supportsAudio: true,
    defaultAudio: true,
    ptbrSpeech: true,
    description: "Fala multilíngue de verdade (incl. português brasileiro) + SFX. Durações fixas: 4, 8 ou 12s.",
  },
  {
    id: "veo3/text-to-video",
    label: "Veo 3 — Texto→Vídeo (com áudio) · requer liberação",
    family: "Veo",
    kind: "text-to-video",
    durations: [8],
    resolutions: ["720p", "1080p"],
    supportsAudio: true,
    defaultAudio: true,
    ptbrSpeech: true,
    description: "Alta qualidade, fala multilíngue (incl. pt-BR). EXIGE allowlist/upgrade na conta Higgsfield — senão dá 404.",
  },
  {
    id: "veo3-fast/text-to-video",
    label: "Veo 3 Fast — Texto→Vídeo (com áudio) · requer liberação",
    family: "Veo",
    kind: "text-to-video",
    durations: [8],
    resolutions: ["720p", "1080p"],
    supportsAudio: true,
    defaultAudio: true,
    ptbrSpeech: true,
    description: "Versão mais rápida do Veo 3, fala multilíngue (incl. pt-BR). EXIGE allowlist/upgrade na conta — senão dá 404.",
  },
  {
    id: "higgsfield-ai/dop/standard",
    label: "DoP — Imagem→Vídeo",
    family: "DoP",
    kind: "image-to-video",
    durations: [5],
    supportsAudio: false,
    description: "Anima uma imagem (gerada ou enviada) em vídeo. Sem áudio nativo.",
  },
];

export function getHfModel(id: string): HfVideoModel | undefined {
  return HF_VIDEO_MODELS.find((m) => m.id === id);
}

export function getHfModelsByFamily(): Record<string, HfVideoModel[]> {
  return HF_VIDEO_MODELS.reduce<Record<string, HfVideoModel[]>>((acc, m) => {
    (acc[m.family] ||= []).push(m);
    return acc;
  }, {});
}