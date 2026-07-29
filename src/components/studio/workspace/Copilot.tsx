import { useState, useRef, useEffect } from "react";
import { Sparkles, Wand2, Lightbulb, Loader2, RefreshCw, Scissors, Smile, ImagePlus, Search, Film, X, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useBrands } from "@/hooks/use-brands";
import {
  generateContent, generateOpenAiImage, searchStockImages, aiAssist,
  callHiggsfield, hfStatus, hfCancel, type HfGenerationResult,
} from "@/lib/api";
import { brandImageDirective, brandTextProfile, brandTextHint, brandVideoDirective, brandVoiceDirective } from "@/lib/brand";
import { HF_VIDEO_MODELS, getHfModel } from "@/lib/higgsfield-models";
import { saveVisualToGallery } from "@/lib/gallery";
import { PLATFORMS } from "@/lib/platforms";
import type { Platform } from "@/types";
import { useStudio } from "./StudioProvider";
import { uid, type Slide, type El } from "./types";

const OBJETIVOS = ["Engajamento", "Vendas", "Autoridade", "Educar", "Tráfego"];
const POST_PLATFORMS: Platform[] = ["instagram", "twitter", "linkedin", "facebook", "tiktok", "threads"];

export function Copilot() {
  const { brands } = useBrands();
  const { doc, selectedEl, replaceDoc, patchEl, patchSlide, currentSlide, set, setPlatforms } = useStudio();
  const brand = brands.find((b) => b.id === doc.brandId) || null;
  const c1 = brand?.colors?.[0] || "#e85600";
  const c2 = brand?.colors?.[1] || "#ff8f39";
  const accent = brand?.colors?.[2] || "#ffffff";

  const [intent, setIntent] = useState("");
  const [objetivo, setObjetivo] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [enhancing, setEnhancing] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState("");
  const [refining, setRefining] = useState<string | null>(null);

  // ── controles de vídeo ──
  const textVideoModels = HF_VIDEO_MODELS.filter((m) => m.kind === "text-to-video");
  const [videoModelId, setVideoModelId] = useState(textVideoModels[0]?.id || HF_VIDEO_MODELS[0].id);
  const videoModel = getHfModel(videoModelId) || textVideoModels[0];
  const [videoDuration, setVideoDuration] = useState<number>(videoModel.durations[0]);
  const [videoResolution, setVideoResolution] = useState<string>(videoModel.resolutions?.[0] || "");
  const [videoAudio, setVideoAudio] = useState<boolean>(!!videoModel.defaultAudio);
  const [audioPrompt, setAudioPrompt] = useState("");

  // ao trocar de modelo, mantém duração/resolução/áudio válidos
  useEffect(() => {
    const m = getHfModel(videoModelId);
    if (!m) return;
    setVideoDuration((d) => (m.durations.includes(d) ? d : m.durations[0]));
    setVideoResolution((r) => (m.resolutions?.includes(r) ? r : m.resolutions?.[0] || ""));
    setVideoAudio(!!m.defaultAudio && m.supportsAudio);
  }, [videoModelId]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoReqRef = useRef<string | null>(null);
  const videoStartRef = useRef<number>(0);
  const VIDEO_TIMEOUT_MS = 10 * 60 * 1000; // 10 min — evita polling infinito
  const stopPolling = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  useEffect(() => () => stopPolling(), []);

  const fullPrompt = () => [intent.trim(), objetivo ? `Objetivo: ${objetivo}.` : "", chosen.length ? `Direções: ${chosen.join("; ")}.` : ""].filter(Boolean).join(" ");

  const handleEnhance = async () => {
    if (!intent.trim()) { toast.error("Escreva uma ideia primeiro."); return; }
    setEnhancing(true);
    try {
      const { text } = await aiAssist({
        system: `Você é estrategista/diretor de arte. Refine e enriqueça a ideia do usuário para gerar conteúdo de rede social ${doc.format}. ${brandTextHint(brand)} Responda APENAS com a ideia final, em português.`,
        prompt: intent.trim(), temperature: 0.7,
      });
      if (text) { setIntent(text); toast.success("Ideia aprimorada"); }
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); } finally { setEnhancing(false); }
  };

  const handleSuggest = async () => {
    const topic = intent.trim() || brand?.industry || brand?.name || "";
    if (!topic) { toast.error("Escreva um tema ou selecione uma marca."); return; }
    setSuggesting(true);
    try {
      const { json } = await aiAssist({
        system: `Você é diretor criativo. Sugira 6 direções curtas (3-5 palavras) — ângulo de conteúdo e estilo visual — para ${doc.format} sobre o tema, alinhadas à marca. ${brandTextHint(brand)} Responda APENAS com um array JSON de strings em português.`,
        prompt: topic, expectJson: true, temperature: 0.9,
      });
      const list = Array.isArray(json) ? (json as string[]).filter((x) => typeof x === "string") : [];
      if (list.length) { setSuggestions(list); toast.success("Direções sugeridas"); } else toast.error("A IA não retornou direções.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); } finally { setSuggesting(false); }
  };

  const brandSlide = (els: El[], bgImage?: string): Slide => ({ bg: `linear-gradient(135deg, ${c1}, ${c2})`, bgImage, els });

  // Card estilo X/Twitter: painel branco sobre fundo da marca, avatar + nome + handle + texto.
  const composeCardSlide = (body: string): Slide => {
    const avatar = brand?.profile_photo_url || brand?.logo_url || "";
    const name = brand?.name || "Sua Marca";
    const handle = brand?.handle || (brand?.name ? `@${brand.name.toLowerCase().replace(/\s+/g, "")}` : "@marca");
    const textX = avatar ? 104 : 44;
    const els: El[] = [
      { id: uid(), type: "shape", x: 24, y: 60, w: 352, h: 280, bg: "#ffffff", radius: 24, opacity: 1 },
    ];
    if (avatar) els.push({ id: uid(), type: "image", x: 44, y: 84, w: 48, h: 48, src: avatar, radius: 24 });
    els.push(
      { id: uid(), type: "text", x: textX, y: 86, w: 250, h: 22, text: name, fontSize: 17, color: "#0f1419", weight: 700, align: "left" },
      { id: uid(), type: "text", x: textX, y: 112, w: 250, h: 20, text: handle, fontSize: 14, color: "#536471", weight: 400, align: "left" },
      { id: uid(), type: "text", x: 44, y: 150, w: 312, h: 170, text: body, fontSize: 21, color: "#0f1419", weight: 500, align: "left" },
    );
    return { bg: `linear-gradient(135deg, ${c1}, ${c2})`, els };
  };

  const genImage = async (extra: string): Promise<string | undefined> => {
    const { images } = await generateOpenAiImage({
      prompt: [brandImageDirective(brand), fullPrompt(), extra].filter(Boolean).join("\n\n"),
      size: "1024x1536", quality: "medium", n: 1,
    });
    return images?.[0];
  };

  const pollVideo = (requestId: string, caption: string) => {
    stopPolling();
    videoReqRef.current = requestId;
    videoStartRef.current = Date.now();
    setProgress("Na fila…");
    pollRef.current = setInterval(async () => {
      const elapsedMs = Date.now() - videoStartRef.current;
      if (elapsedMs > VIDEO_TIMEOUT_MS) {
        stopPolling(); videoReqRef.current = null;
        setGenerating(false); setProgress("");
        toast.error("O vídeo demorou demais. Tente de novo ou escolha um modelo mais rápido.");
        return;
      }
      try {
        const st = await hfStatus(requestId);
        if (st.status === "completed" && st.video?.url) {
          stopPolling(); videoReqRef.current = null;
          set({ videoUrl: st.video.url, caption });
          setGenerating(false); setProgress("");
          toast.success("Vídeo gerado!");
          saveVisualToGallery({ urls: [st.video.url], prompt: intent.trim(), templateName: "Studio · Copiloto", id: doc.galleryId });
        } else if (st.status === "failed" || st.status === "nsfw") {
          stopPolling(); videoReqRef.current = null;
          setGenerating(false); setProgress("");
          toast.error(st.error || "Vídeo falhou.");
        } else {
          setProgress(`Gerando vídeo… ${Math.round(elapsedMs / 1000)}s`);
        }
      } catch { /* erro transitório: segue tentando até o timeout */ }
    }, 5000);
  };

  const handleCancelVideo = async () => {
    const id = videoReqRef.current;
    stopPolling(); videoReqRef.current = null;
    setGenerating(false); setProgress("");
    if (id) { try { await hfCancel(id); } catch { /* ignora */ } }
    toast.info("Geração de vídeo cancelada.");
  };

  const handleGenerate = async () => {
    if (!intent.trim()) { toast.error("Descreva o que você quer criar."); return; }
    setGenerating(true); setProgress("");
    try {
      const topic = fullPrompt();

      if (doc.format === "image") {
        setProgress("Gerando imagem…");
        const img = await genImage("");
        if (!img) { toast.error("Falha ao gerar imagem."); return; }
        replaceDoc({ ...doc, slides: [brandSlide([], img)], caption: intent.trim() });
        toast.success("Imagem gerada");
        if (img) saveVisualToGallery({ urls: [img], prompt: intent.trim(), templateName: "Studio · Copiloto", id: doc.galleryId });
      } else if (doc.format === "card") {
        setProgress("Escrevendo o card…");
        const { text } = await aiAssist({
          system: `Você é redator. Escreva um texto curto e impactante estilo post de X/Twitter (1 a 3 frases) em português brasileiro, na voz da marca, sem hashtags. ${brandTextHint(brand)} Responda APENAS com o texto.`,
          prompt: topic, temperature: 0.85,
        });
        const body = (text || intent.trim()).trim();
        const cardSlide = composeCardSlide(body);
        replaceDoc({ ...doc, slides: [cardSlide], caption: body });
        toast.success("Card gerado");
        // card sem bgImage = fundo gradiente, não tem URL persistente → salva após export
      } else if (doc.format === "post") {
        setProgress("Escrevendo + gerando imagem…");
        const [res, img] = await Promise.all([
          generateContent({ prompt: topic, platforms: doc.platforms, tone: brand?.tone, language: "português brasileiro", brandProfile: brandTextProfile(brand) }),
          genImage(""),
        ]);
        const plat = doc.platforms[0];
        replaceDoc({
          ...doc,
          slides: [brandSlide([], img)],
          caption: res.posts?.[plat] || Object.values(res.posts || {})[0] || intent.trim(),
          captionsByPlatform: res.posts,
          hashtags: res.hashtags || [],
        });
        toast.success("Post gerado");
        if (img) saveVisualToGallery({ urls: [img], prompt: intent.trim(), templateName: "Studio · Copiloto", id: doc.galleryId });
      } else if (doc.format === "carousel") {
        setProgress("Montando carrossel…");
        const res = await generateContent({ prompt: `${topic}. Gere um carrossel de 5 slides.`, platforms: ["instagram"], tone: brand?.tone, language: "português brasileiro", brandProfile: brandTextProfile(brand) });
        const cs = res.carousel?.slides || [];
        if (!cs.length) { toast.error("A IA não retornou slides."); return; }
        const slides: Slide[] = cs.map((s) => brandSlide([
          { id: uid(), type: "text", x: 30, y: 110, w: 340, h: 100, text: s.heading, fontSize: 28, color: accent, weight: 700, align: "left" },
          { id: uid(), type: "text", x: 30, y: 220, w: 340, h: 90, text: s.body, fontSize: 16, color: accent, weight: 400, align: "left" },
        ]));
        replaceDoc({ ...doc, slides, caption: res.posts?.instagram || res.carousel?.title || intent.trim(), hashtags: res.hashtags || [] });
        toast.success("Carrossel gerado");
        const carouselUrls = slides.map((s) => s.bgImage).filter((u): u is string => !!u);
        if (carouselUrls.length) saveVisualToGallery({ urls: carouselUrls, prompt: intent.trim(), templateName: "Studio · Copiloto", id: doc.galleryId });
      } else if (doc.format === "video") {
        setProgress("Enviando para geração…");
        const model = videoModel;
        const audioOn = !!videoAudio && model.supportsAudio;
        const promptParts = [brandVideoDirective(brand), topic];
        if (audioOn) {
          promptParts.push(brandVoiceDirective(brand));
          if (audioPrompt.trim()) promptParts.push(`Roteiro de narração: ${audioPrompt.trim()}`);
        }
        const args: Record<string, unknown> = {
          model: model.id,
          prompt: promptParts.filter(Boolean).join("\n\n"),
          duration: videoDuration,
          with_audio: audioOn,
          audio_language: "pt-BR",
        };
        if (videoResolution) args.resolution = videoResolution;
        if (audioOn && audioPrompt.trim()) args.audio_prompt = audioPrompt.trim();
        const r = await callHiggsfield("hf_text_to_video_direct", args) as HfGenerationResult;
        if (!r?.request_id) throw new Error("Sem request_id.");
        pollVideo(r.request_id, intent.trim());
        return; // mantém generating até o poll terminar
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao gerar");
    } finally {
      if (doc.format !== "video") { setGenerating(false); setProgress(""); }
    }
  };

  // ── refino contextual ──
  const refineText = async (kind: "rewrite" | "shorten" | "emojis") => {
    if (!selectedEl || selectedEl.type !== "text") return;
    const instr = kind === "rewrite" ? "Reescreva mais persuasivo e fluido" : kind === "shorten" ? "Reescreva mais curto e direto" : "Adicione emojis pontuais";
    setRefining(kind);
    try {
      const { text } = await aiAssist({
        system: `Você é redator. ${instr}, mantendo o sentido. ${brandTextHint(brand)} Responda APENAS com o texto final.`,
        prompt: selectedEl.text || "", temperature: 0.7,
      });
      if (text) patchEl(selectedEl.id, { text });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); } finally { setRefining(null); }
  };

  const refineImage = async (source: "ai" | "pexels") => {
    setRefining(source);
    try {
      const q = intent.trim() || selectedEl?.text || brand?.industry || brand?.name || "imagem";
      let url: string | undefined;
      if (source === "ai") {
        const { images } = await generateOpenAiImage({ prompt: [brandImageDirective(brand), q].filter(Boolean).join("\n\n"), size: "1024x1536", quality: "medium", n: 1 });
        url = images?.[0];
      } else {
        const { images } = await searchStockImages({ query: q, count: 1, orientation: "squarish" });
        url = images?.[0]?.url;
      }
      if (!url) { toast.error("Nenhuma imagem."); return; }
      if (selectedEl?.type === "image") patchEl(selectedEl.id, { src: url });
      else patchSlide(currentSlide, { bgImage: url });
      toast.success("Imagem aplicada");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); } finally { setRefining(null); }
  };

  // ── render ──
  return (
    <div className="space-y-4">

      {/* Ações contextuais */}
      {selectedEl?.type === "text" && (
        <div className="card-premium space-y-1.5 p-3">
          <Label className="text-xs">IA neste texto</Label>
          <div className="flex flex-wrap gap-1.5">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => refineText("rewrite")} disabled={!!refining}>{refining === "rewrite" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}Reescrever</Button>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => refineText("shorten")} disabled={!!refining}>{refining === "shorten" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Scissors className="mr-1 h-3 w-3" />}Encurtar</Button>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => refineText("emojis")} disabled={!!refining}>{refining === "emojis" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Smile className="mr-1 h-3 w-3" />}+Emojis</Button>
          </div>
        </div>
      )}

      {(selectedEl?.type === "image" || (!selectedEl && (doc.format === "image" || doc.format === "post" || doc.format === "carousel" || doc.format === "card"))) && (
        <div className="card-premium space-y-1.5 p-3">
          <Label className="text-xs">{selectedEl?.type === "image" ? "Imagem do elemento" : "Imagem de fundo do slide"}</Label>
          <Textarea value={intent} onChange={(e) => setIntent(e.target.value)} rows={2}
            placeholder="Descreva a imagem que a IA deve gerar (ex: prato de peixe, luz quente)" className="text-xs" />
          <div className="flex flex-wrap gap-1.5">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => refineImage("ai")} disabled={!!refining}>{refining === "ai" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ImagePlus className="mr-1 h-3 w-3" />}Gerar IA</Button>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => refineImage("pexels")} disabled={!!refining}>{refining === "pexels" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Search className="mr-1 h-3 w-3" />}Pexels</Button>
          </div>
        </div>
      )}

      {doc.format === "video" && (
        <p className="flex items-start gap-1.5 rounded-lg border border-border p-3 text-[11px] text-muted-foreground">
          <Film className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Vídeo via Higgsfield (requer credenciais em Configurações). A geração leva alguns minutos.
        </p>
      )}
    </div>
  );
}
