import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { brandToAIProfile, brandImageDirective, brandVideoDirective, brandVoiceDirective, type BrandRow } from "../_shared/brand.ts";
import { OPENAI_TEXT_MODEL, OPENAI_IMAGE_MODEL, requireUser, HttpError } from "../_shared/ai.ts";

/**
 * Autopilot Run — Pipeline principal de automação
 *
 * Actions:
 *   generate       — Pesquisa + gera roteiro de posts para o ciclo
 *   schedule       — Gera visuais + agenda posts aprovados
 *   check_visuals  — Verifica status de visuais pendentes
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ─── Helpers ────────────────────────────────────────────────────

function supabaseAdmin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { db: { schema: 'public' } });
}

function supabaseForUser(authHeader: string) {
  return createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { db: { schema: 'public' },
    global: { headers: { Authorization: authHeader } },
  });
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 500) {
  return jsonResponse({ error: message }, status);
}

// Faz upload de um data URL (base64) para o storage `media` e devolve a URL pública.
async function uploadDataUrl(
  sb: ReturnType<typeof supabaseAdmin>,
  userId: string,
  dataUrl: string
): Promise<string | null> {
  try {
    const [head, b64] = dataUrl.split(",");
    const mime = /:(.*?);/.exec(head)?.[1] || "image/png";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const path = `autopilot/${userId}/${crypto.randomUUID()}.png`;
    const { error } = await sb.storage.from("media").upload(path, bytes, { contentType: mime });
    if (error) { console.error("[autopilot] upload error:", error.message); return null; }
    return sb.storage.from("media").getPublicUrl(path).data.publicUrl;
  } catch (e) {
    console.error("[autopilot] uploadDataUrl:", e instanceof Error ? e.message : e);
    return null;
  }
}

// ─── Firecrawl Search ───────────────────────────────────────────

async function firecrawlSearch(
  apiKey: string,
  query: string,
  limit = 5
): Promise<{ url: string; title: string; markdown: string }[]> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/firecrawl-search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-firecrawl-api-key": apiKey,
      apikey: Deno.env.get("SUPABASE_ANON_KEY")!,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({ query, limit }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.results || [];
}

// Scrape direto de uma URL (conteúdo real, não SERP) via Firecrawl /v1/scrape.
async function firecrawlScrape(
  apiKey: string,
  url: string
): Promise<{ url: string; title: string; markdown: string } | null> {
  try {
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const md = data?.data?.markdown || data?.markdown || "";
    const title = data?.data?.metadata?.title || data?.metadata?.title || url;
    if (!md) return null;
    return { url, title, markdown: md };
  } catch {
    return null;
  }
}

// ─── AI Content Generation ──────────────────────────────────────
// Reaproveita a MESMA function do Studio (generate-content) para unificar
// qualidade de texto e marca-raiz. Sem implementação de IA divergente aqui.

async function generatePostContent(
  platform: string,
  topic: string,
  researchContext: string,
  brand: BrandRow | null,
  visualFormat: string,
  contentTypes?: string[],
  toneOverride?: string
): Promise<{
  text: string;
  hashtags: string[];
  carousel?: { title: string; slides: { heading: string; body: string }[] };
}> {
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const wantCarousel = visualFormat === "carousel" || visualFormat === "auto";
  const ctLine = contentTypes?.length ? ` Tipo de conteúdo: ${contentTypes.join(", ")}.` : "";

  const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-content`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anon,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({
      prompt: `${topic}.${ctLine}`,
      platforms: [platform],
      tone: toneOverride || brand?.tone,
      language: "português brasileiro",
      sourceContent: researchContext ? researchContext.slice(0, 3000) : undefined,
      brandProfile: brandToAIProfile(brand),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`generate-content ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text = data.posts?.[platform] || Object.values(data.posts || {})[0] || "";
  return {
    text: String(text),
    hashtags: data.hashtags || [],
    carousel: wantCarousel ? data.carousel : undefined,
  };
}

// ─── Referência de contas do Instagram (estilo/inspiração) ──────
// Usa social-analytics (Apify) p/ puxar legendas recentes de @ de referência.
async function fetchIgReferenceContext(apifyToken: string, handles: string[]): Promise<string> {
  const clean = Array.from(new Set(handles.map((h) => String(h).replace(/^@/, "").trim()).filter(Boolean)));
  if (!clean.length || !apifyToken) return "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/social-analytics`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "x-apify-api-token": apifyToken },
      body: JSON.stringify({ accounts: clean.map((u) => ({ platform: "instagram", username: u })), enrich: false }),
    });
    if (!res.ok) return "";
    const data = await res.json();
    const profiles = Array.isArray(data) ? data : (data.profiles || data.results || []);
    const blocks: string[] = [];
    for (const p of profiles) {
      const caps = (p?.recentPosts || []).map((x: { text?: string }) => x?.text).filter(Boolean).slice(0, 5);
      if (caps.length) blocks.push(`Estilo de referência (@${p.username || ""}):\n- ${caps.join("\n- ")}`);
    }
    return blocks.join("\n\n");
  } catch {
    return "";
  }
}

// ─── Compute schedule slots ─────────────────────────────────────

// Map of timezone → UTC offset in hours (negative = behind UTC)
const TZ_OFFSETS: Record<string, number> = {
  "America/Sao_Paulo": -3,
  "America/Manaus": -4,
  "America/Noronha": -2,
  "America/Rio_Branco": -5,
};

// Offset (horas) de um fuso via Intl — robusto e com DST (não mais hardcoded BR).
function tzOffsetHours(timezone: string, at: Date): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const parts = Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value]));
    const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    return Math.round((asUTC - at.getTime()) / 60000) / 60; // horas
  } catch {
    return -3; // fallback America/Sao_Paulo
  }
}

// Duração do ciclo em dias por recorrência (daily depende de posts/dia).
function cycleLengthDays(recurrence: string, postsPerCycle: number, timesPerDay: number): number {
  if (recurrence === "daily") return Math.max(1, Math.ceil(postsPerCycle / Math.max(1, timesPerDay)));
  if (recurrence === "monthly") return 30;
  if (recurrence === "biweekly") return 14;
  return 7; // weekly
}

export interface Slot { at: Date; dow: number }

function computeSlots(
  postsPerCycle: number,
  preferredDays: number[],
  preferredTimes: string[],
  recurrence: string,
  timezone: string
): Slot[] {
  const slots: Slot[] = [];
  const times = preferredTimes?.length ? preferredTimes : ["09:00"];
  // diária = todos os dias; demais respeitam preferred_days
  const days = recurrence === "daily" ? [0, 1, 2, 3, 4, 5, 6] : (preferredDays?.length ? preferredDays : [1, 3, 5]);
  const window = Math.max(cycleLengthDays(recurrence, postsPerCycle, times.length), 1);

  // Começa "amanhã" no fuso do usuário.
  const tzNow = tzOffsetHours(timezone, new Date());
  const nowLocal = new Date(Date.now() + tzNow * 3600_000);
  const startDate = new Date(Date.UTC(nowLocal.getUTCFullYear(), nowLocal.getUTCMonth(), nowLocal.getUTCDate() + 1));

  let dayOffset = 0;
  const maxDays = window + 7; // folga para encontrar dias preferidos
  while (slots.length < postsPerCycle && dayOffset < maxDays) {
    const day = new Date(startDate);
    day.setUTCDate(day.getUTCDate() + dayOffset);
    const dow = day.getUTCDay();
    if (days.includes(dow)) {
      for (const time of times) {
        if (slots.length >= postsPerCycle) break;
        const [h, m] = time.split(":").map(Number);
        // Converte hora local → UTC usando o offset DAQUELE dia (DST-safe).
        const off = tzOffsetHours(timezone, day);
        const utcSlot = new Date(day);
        utcSlot.setUTCHours(h - off, m, 0, 0);
        slots.push({ at: utcSlot, dow });
      }
    }
    dayOffset++;
  }
  return slots;
}

function computeNextRun(recurrence: string, postsPerCycle = 5, timesPerDay = 2): Date {
  const next = new Date();
  next.setDate(next.getDate() + cycleLengthDays(recurrence, postsPerCycle, timesPerDay));
  next.setHours(6, 0, 0, 0);
  return next;
}

function cycleRange(recurrence: string, postsPerCycle = 5, timesPerDay = 2): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() + 1);
  const end = new Date(start);
  end.setDate(end.getDate() + cycleLengthDays(recurrence, postsPerCycle, timesPerDay) - 1);
  return {
    start: start.toISOString().split("T")[0],
    end: end.toISOString().split("T")[0],
  };
}

// ─── Temas (motivos complementares) ─────────────────────────────

export interface AutopilotTheme {
  name: string;
  subject: string;
  visual_format?: string;
  reference_accounts: string[];
  tone?: string;
  days?: number[];
  content_types?: string[];
}

// Normaliza config.themes; cai para research_topics (legado) se não houver temas.
export function normalizeThemes(config: Record<string, unknown>): AutopilotTheme[] {
  const raw = Array.isArray(config.themes) ? (config.themes as Record<string, unknown>[]) : [];
  const globalRefs = Array.isArray(config.reference_accounts) ? (config.reference_accounts as string[]) : [];
  const themes = raw
    .filter((t) => t && (t.subject || t.name))
    .map((t) => ({
      name: String(t.name || t.subject),
      subject: String(t.subject || t.name),
      visual_format: t.visual_format ? String(t.visual_format) : undefined,
      reference_accounts: Array.isArray(t.reference_accounts) && t.reference_accounts.length
        ? (t.reference_accounts as string[]) : globalRefs,
      tone: t.tone ? String(t.tone) : undefined,
      days: Array.isArray(t.days) ? (t.days as number[]) : undefined,
      content_types: Array.isArray(t.content_types) ? (t.content_types as string[]) : undefined,
    }));
  if (themes.length) return themes;
  const topics = (config.research_topics as string[]) || [];
  if (topics.length) return topics.map((t) => ({ name: t, subject: t, reference_accounts: globalRefs }));
  return [{ name: "Geral", subject: "novidades e conteúdo relevante da área", reference_accounts: globalRefs }];
}

// Atribui um tema a cada slot, respeitando theme.days quando definido,
// com rodízio entre os temas candidatos àquele dia.
export function assignThemesToSlots(slots: Slot[], themes: AutopilotTheme[]): AutopilotTheme[] {
  const counters: Record<string, number> = {};
  return slots.map((slot) => {
    let candidates = themes.filter((t) => (t.days?.length ? t.days.includes(slot.dow) : true));
    if (!candidates.length) candidates = themes;
    const key = candidates.map((c) => c.name).join("|");
    const i = counters[key] ?? 0;
    counters[key] = i + 1;
    return candidates[i % candidates.length];
  });
}

// ─── Action: Generate ───────────────────────────────────────────

async function handleGenerate(configId: string, userId?: string) {
  const sb = supabaseAdmin();

  // Load config
  const { data: config, error: cfgErr } = await sb
    .from("autopilot_configs")
    .select("*")
    .eq("id", configId)
    .single();

  if (cfgErr || !config) throw new Error(`Config not found: ${cfgErr?.message}`);

  const effectiveUserId = userId || config.user_id;

  // Load brand profile
  let brand: BrandRow | null = null;
  if (config.brand_id) {
    const { data } = await sb
      .from("brand_profiles")
      .select("*")
      .eq("id", config.brand_id)
      .single();
    brand = data;
  }

  // Load user keys (firecrawl + apify p/ referências de IG)
  const { data: userCfg } = await sb
    .from("user_configs")
    .select("firecrawl_api_key, apify_api_token")
    .eq("user_id", effectiveUserId)
    .single();

  const firecrawlKey = userCfg?.firecrawl_api_key;
  const apifyToken = userCfg?.apify_api_token;

  // Temas (motivos complementares) — cai p/ research_topics se não houver temas.
  const themes = normalizeThemes(config);
  const timesPerDay = (config.preferred_times || ["09:00", "18:00"]).length || 1;

  // 1. Pesquisa: scrape global (research_urls) + busca por assunto de cada tema +
  //    legendas de @ de referência (cache por chave p/ não repetir chamadas).
  const allResults: { url: string; title: string; markdown: string }[] = [];
  const subjectCtx: Record<string, string> = {};
  const igCtx: Record<string, string> = {};

  let globalContext = "";
  if (firecrawlKey && config.research_urls?.length) {
    for (const url of config.research_urls) {
      const scraped = await firecrawlScrape(firecrawlKey, url);
      if (scraped) { allResults.push(scraped); }
    }
    globalContext = allResults.map((r) => `## ${r.title}\n${r.markdown?.slice(0, 400) || ""}`).join("\n\n");
  }

  for (const theme of themes) {
    // pesquisa do assunto (dedupe por subject)
    if (firecrawlKey && !(theme.subject in subjectCtx)) {
      const results = await firecrawlSearch(firecrawlKey, theme.subject, 3);
      for (const r of results) allResults.push(r);
      subjectCtx[theme.subject] = results.map((r) => `## ${r.title}\n${r.markdown?.slice(0, 400) || ""}`).join("\n\n");
    }
    // referência de Instagram (dedupe pela lista de handles)
    const refKey = (theme.reference_accounts || []).slice().sort().join(",");
    if (apifyToken && refKey && !(refKey in igCtx)) {
      igCtx[refKey] = await fetchIgReferenceContext(apifyToken, theme.reference_accounts);
    }
  }

  console.log(`[autopilot] ${themes.length} temas, ${allResults.length} resultados de pesquisa`);

  // 2. Cria calendário
  const range = cycleRange(config.recurrence, config.posts_per_cycle, timesPerDay);
  const { data: calendar, error: calErr } = await sb
    .from("autopilot_calendars")
    .insert({
      user_id: effectiveUserId,
      config_id: configId,
      cycle_start: range.start,
      cycle_end: range.end,
      status: config.requires_approval ? "draft" : "approved",
      research_results: allResults.map((r) => ({ url: r.url, title: r.title, summary: r.markdown?.slice(0, 500) || "" })),
    })
    .select()
    .single();

  if (calErr || !calendar) throw new Error(`Failed to create calendar: ${calErr?.message}`);

  // 3. Slots + atribuição de temas (respeita theme.days quando definido)
  const slots = computeSlots(
    config.posts_per_cycle,
    config.preferred_days || [1, 3, 5],
    config.preferred_times || ["09:00", "18:00"],
    config.recurrence,
    config.timezone
  );
  const slotThemes = assignThemesToSlots(slots, themes);

  const platforms = config.platforms || ["instagram"];
  const posts: Record<string, unknown>[] = [];

  for (let i = 0; i < slots.length; i++) {
    const platform = platforms[i % platforms.length];
    const theme = slotThemes[i];
    const topic = theme.subject || brand?.name || "conteúdo";
    const fmt = theme.visual_format || config.visual_format;
    const tone = theme.tone || config.tone || undefined;
    const contentTypes = theme.content_types || config.content_types;
    const refKey = (theme.reference_accounts || []).slice().sort().join(",");
    const researchContext = [globalContext, subjectCtx[theme.subject] || "", igCtx[refKey] || ""]
      .filter(Boolean).join("\n\n");

    try {
      console.log(`[autopilot] Post ${i + 1}/${slots.length} — tema "${theme.name}" (${platform})`);
      const content = await generatePostContent(platform, topic, researchContext, brand, fmt, contentTypes, tone);
      posts.push({
        user_id: effectiveUserId,
        calendar_id: calendar.id,
        platform,
        text_content: content.text,
        hashtags: content.hashtags || [],
        carousel_data: content.carousel || null,
        scheduled_at: slots[i].at.toISOString(),
        status: config.requires_approval ? "draft" : "approved",
        source_topic: topic,
        theme_name: theme.name,
        visual_format: fmt,
      });
    } catch (err) {
      console.error(`[autopilot] Falha no post ${i + 1}:`, err);
      posts.push({
        user_id: effectiveUserId,
        calendar_id: calendar.id,
        platform,
        text_content: `[Erro na geração] ${topic}`,
        hashtags: [],
        scheduled_at: slots[i].at.toISOString(),
        status: "failed",
        error_message: err instanceof Error ? err.message : "Erro desconhecido",
        source_topic: topic,
        theme_name: theme.name,
        visual_format: fmt,
      });
    }
  }

  if (posts.length > 0) {
    const { error: insertErr } = await sb.from("autopilot_posts").insert(posts);
    if (insertErr) console.error("[autopilot] Insert posts error:", insertErr.message);
  }

  // 4. Atualiza config (próximo ciclo conforme recorrência)
  await sb
    .from("autopilot_configs")
    .update({
      last_run_at: new Date().toISOString(),
      next_run_at: computeNextRun(config.recurrence, config.posts_per_cycle, timesPerDay).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", configId);

  return {
    calendar_id: calendar.id,
    posts_generated: posts.length,
    research_results: allResults.length,
  };
}

// ─── Action: Schedule ───────────────────────────────────────────

async function handleSchedule(calendarId: string) {
  const sb = supabaseAdmin();

  // Load approved posts without pfm_post_id
  const { data: posts, error } = await sb
    .from("autopilot_posts")
    .select("*")
    .eq("calendar_id", calendarId)
    .in("status", ["approved", "visual_ready"])
    .is("pfm_post_id", null);

  if (error || !posts?.length) {
    return { scheduled: 0, message: "Nenhum post para agendar" };
  }

  // Load user config for PFM key
  const userId = posts[0].user_id;
  const { data: userCfg } = await sb
    .from("user_configs")
    .select("postforme_api_key")
    .eq("user_id", userId)
    .single();

  const pfmKey = userCfg?.postforme_api_key;
  if (!pfmKey) throw new Error("PostForMe API key não configurada");

  // Load autopilot config for social_account_ids
  const { data: calendar } = await sb
    .from("autopilot_calendars")
    .select("config_id")
    .eq("id", calendarId)
    .single();

  const { data: config } = await sb
    .from("autopilot_configs")
    .select("social_account_ids, visual_format, brand_id, image_provider, video_model")
    .eq("id", calendar?.config_id)
    .single();

  // Credenciais de mídia (Higgsfield p/ vídeo) e brand (raiz dos visuais)
  const { data: mediaCfg } = await sb
    .from("user_configs")
    .select("higgsfield_api_id, higgsfield_api_secret")
    .eq("user_id", userId)
    .single();
  const hfId = mediaCfg?.higgsfield_api_id;
  const hfSecret = mediaCfg?.higgsfield_api_secret;

  let brandRow: BrandRow | null = null;
  if (config?.brand_id) {
    const { data } = await sb.from("brand_profiles").select("*").eq("id", config.brand_id).single();
    brandRow = data;
  }

  const cfgFmt = config?.visual_format || "none";
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;

  let scheduled = 0;
  let pendingVisuals = 0;

  for (const post of posts) {
    try {
      // Formato por POST (definido pelo tema), com fallback no config.
      const fmt = post.visual_format || cfgFmt;
      // ── Gera o visual conforme formato/provider (marca como raiz) ──
      const needsVisual = fmt !== "none" && !post.media_urls?.length && !post.visual_creation_id;
      if (needsVisual) {
        // VÍDEO via Higgsfield (assíncrono → polling em check_visuals)
        if (fmt === "video" && hfId && hfSecret) {
          try {
            const model = config?.video_model || "kling-video/v2.6/pro/text-to-video";
            // Sora 2 só aceita 4/8/12s; demais usam 5s.
            const duration = model.includes("sora") ? 8 : 5;
            const prompt = [
              brandVideoDirective(brandRow),
              post.source_topic ? `Tema: ${post.source_topic}.` : "",
              post.text_content.slice(0, 600),
              brandVoiceDirective(brandRow),
            ].filter(Boolean).join("\n\n");
            const r = await fetch(`${SUPABASE_URL}/functions/v1/higgsfield-proxy`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
                "x-higgsfield-api-id": hfId, "x-higgsfield-api-secret": hfSecret,
              },
              body: JSON.stringify({ tool: "hf_text_to_video_direct", args: { model, prompt, duration, with_audio: true, audio_language: "pt-BR" } }),
            });
            if (r.ok) {
              const v = await r.json();
              if (v.request_id) {
                await sb.from("autopilot_posts").update({ status: "generating_visual", visual_creation_id: v.request_id, visual_provider: "higgsfield", updated_at: new Date().toISOString() }).eq("id", post.id);
                pendingVisuals++; continue;
              }
            }
          } catch (e) { console.error(`[autopilot] HF video for ${post.id}:`, e); }
        }
        // IMAGEM via OpenAI gpt-image-2 (síncrono — já anexa media_urls).
        // Arte 100% gpt-image-2: o estilo (quote/infográfico/etc) vai no prompt.
        else {
          try {
            const styleHint = fmt === "carousel" ? "estilo carrossel, slide único com destaque"
              : fmt === "infographic" ? "estilo infográfico limpo com hierarquia visual"
              : "card de redes sociais com o texto em destaque";
            const prompt = [
              brandImageDirective(brandRow),
              `Crie uma arte para redes sociais (${styleHint}).`,
              post.source_topic ? `Tema central: ${post.source_topic}.` : "",
              `Texto/tema: ${post.text_content.slice(0, 300)}`,
              "Composição profissional e original, pronta para publicação.",
            ].filter(Boolean).join("\n\n");
            const r = await fetch(`${SUPABASE_URL}/functions/v1/openai-image`, {
              method: "POST",
              headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
              body: JSON.stringify({ prompt, size: "1024x1536", quality: "medium", n: 1 }),
            });
            if (r.ok) {
              const data = await r.json();
              const dataUrl = data.images?.[0];
              if (typeof dataUrl === "string" && dataUrl.startsWith("data:")) {
                const url = await uploadDataUrl(sb, userId, dataUrl);
                if (url) {
                  post.media_urls = [url];
                  await sb.from("autopilot_posts").update({ media_urls: [url], visual_provider: "openai", updated_at: new Date().toISOString() }).eq("id", post.id);
                }
              }
            }
          } catch (e) { console.error(`[autopilot] OpenAI image for ${post.id}:`, e); }
        }
      }

      // Schedule via PFM proxy
      const pfmPayload = {
        tool: "pfm_create_post",
        args: {
          caption: post.text_content + (post.hashtags?.length ? "\n\n" + post.hashtags.map((h: string) => `#${h}`).join(" ") : ""),
          social_accounts: config?.social_account_ids || [],
          media: post.media_urls || [],
          scheduled_at: post.scheduled_at,
        },
      };

      const res = await fetch(`${SUPABASE_URL}/functions/v1/postforme-proxy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-pfm-api-key": pfmKey,
          apikey: Deno.env.get("SUPABASE_ANON_KEY")!,
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
        },
        body: JSON.stringify(pfmPayload),
      });

      if (res.ok) {
        const result = await res.json();
        const pfmPostId = result?.data?.id || result?.id || null;

        await sb
          .from("autopilot_posts")
          .update({
            status: "scheduled",
            pfm_post_id: pfmPostId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", post.id);

        scheduled++;
      } else {
        const errText = await res.text();
        await sb
          .from("autopilot_posts")
          .update({
            status: "failed",
            error_message: `PFM ${res.status}: ${errText}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", post.id);
      }
    } catch (err) {
      console.error(`[autopilot] Schedule post ${post.id} failed:`, err);
    }
  }

  // Update calendar status
  if (pendingVisuals > 0) {
    // Some posts still generating visuals — mark as "scheduling"
    await sb
      .from("autopilot_calendars")
      .update({ status: "scheduling", updated_at: new Date().toISOString() })
      .eq("id", calendarId);
  } else if (scheduled > 0) {
    // All posts scheduled — mark as "active"
    await sb
      .from("autopilot_calendars")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .eq("id", calendarId);
  }

  return { scheduled, pending_visuals: pendingVisuals };
}

// ─── Action: Check Visuals ──────────────────────────────────────

async function handleCheckVisuals(calendarId: string) {
  const sb = supabaseAdmin();

  const { data: posts } = await sb
    .from("autopilot_posts")
    .select("*")
    .eq("calendar_id", calendarId)
    .eq("status", "generating_visual");

  if (!posts?.length) return { checked: 0 };

  const userId = posts[0].user_id;
  const { data: userCfg } = await sb
    .from("user_configs")
    .select("higgsfield_api_id, higgsfield_api_secret")
    .eq("user_id", userId)
    .single();

  const hfId = userCfg?.higgsfield_api_id;
  const hfSecret = userCfg?.higgsfield_api_secret;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const VISUAL_MAX_AGE_MS = 15 * 60 * 1000; // 15 min — destrava posts que nunca completam
  const nowMs = Date.now();
  let updated = 0;

  for (const post of posts) {
    // Timeout de segurança: post preso em generating_visual há muito tempo é
    // liberado (volta a "approved" sem o visual) para o ciclo não travar pra sempre.
    const ageMs = post.updated_at ? nowMs - new Date(post.updated_at).getTime() : 0;
    if (ageMs > VISUAL_MAX_AGE_MS) {
      await sb.from("autopilot_posts").update({ status: "approved", visual_creation_id: null, error_message: "Visual demorou demais e foi cancelado.", updated_at: new Date().toISOString() }).eq("id", post.id);
      updated++;
      continue;
    }
    if (!post.visual_creation_id) continue;
    // Único provider assíncrono = Higgsfield (vídeo). Imagem OpenAI é síncrona e
    // nunca entra em "generating_visual". Qualquer outro provider é resíduo legado → skip.
    if (post.visual_provider !== "higgsfield") continue;

    try {
      let mediaUrls: string[] | null = null;
      let failed: string | null = null;

      if (!hfId || !hfSecret) continue;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/higgsfield-proxy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          "x-higgsfield-api-id": hfId, "x-higgsfield-api-secret": hfSecret,
        },
        body: JSON.stringify({ tool: "hf_status", args: { request_id: post.visual_creation_id } }),
      });
      if (!res.ok) continue;
      const st = await res.json();
      if (st.status === "completed" && st.video?.url) mediaUrls = [st.video.url];
      else if (st.status === "failed" || st.status === "nsfw") failed = st.error || "Vídeo falhou";

      if (mediaUrls) {
        await sb.from("autopilot_posts").update({ status: "visual_ready", media_urls: mediaUrls, updated_at: new Date().toISOString() }).eq("id", post.id);
        updated++;
      } else if (failed !== null) {
        await sb.from("autopilot_posts").update({ status: "approved", error_message: `Visual falhou: ${failed}`, updated_at: new Date().toISOString() }).eq("id", post.id);
        updated++;
      }
    } catch (err) {
      console.error(`[autopilot] Check visual for post ${post.id}:`, err);
    }
  }

  // Sem mais visuais pendentes → devolve o calendário a "approved" para o cron
  // reagendar os posts que ficaram com visual_ready (fecha o ciclo gerar→agendar).
  const { count: stillPending } = await sb
    .from("autopilot_posts")
    .select("id", { count: "exact", head: true })
    .eq("calendar_id", calendarId)
    .eq("status", "generating_visual");
  if (!stillPending) {
    await sb
      .from("autopilot_calendars")
      .update({ status: "approved", updated_at: new Date().toISOString() })
      .eq("id", calendarId);
  }

  return { checked: posts.length, updated };
}

// ─── Action: Confirm Publication ─────────────────────────────────
// Polling PFM pra confirmar publicação real (scheduled → published).

async function handleConfirm(calendarId: string) {
  const sb = supabaseAdmin();
  const { data: posts } = await sb
    .from("autopilot_posts")
    .select("id, pfm_post_id, user_id, platform")
    .eq("calendar_id", calendarId)
    .eq("status", "scheduled");

  if (!posts?.length) return { confirmed: 0 };

  const userId = posts[0].user_id;
  const { data: userCfg } = await sb.from("user_configs").select("postforme_api_key").eq("user_id", userId).single();
  const pfmKey = userCfg?.postforme_api_key;
  if (!pfmKey) return { confirmed: 0, error: "PFM key not found" };

  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  let confirmed = 0;

  // Busca posts recentes processados no PFM
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/postforme-proxy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-pfm-api-key": pfmKey, apikey: anon, Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}` },
      body: JSON.stringify({ tool: "pfm_list_posts", args: { status: "processed", limit: 50 } }),
    });
    if (!res.ok) return { confirmed: 0, error: `PFM ${res.status}` };

    const pfmData = await res.json();
    const processed = pfmData?.data || [];
    const pfmIds = new Set(processed.map((p: { id?: string }) => p.id).filter(Boolean));

    for (const post of posts) {
      if (post.pfm_post_id && pfmIds.has(post.pfm_post_id)) {
        // Busca URL e engagement do post publicado
        const pfmPost = processed.find((p: { id: string }) => p.id === post.pfm_post_id);
        const platformUrl = pfmPost?.platform_url || pfmPost?.results?.[0]?.platform_url || null;
        const engagement = pfmPost?.results?.[0]?.engagement || null;

        await sb.from("autopilot_posts").update({
          status: "published",
          updated_at: new Date().toISOString(),
          // Armazenamos engagement e URL nos campos existentes (source_url para a URL publicada)
          source_url: platformUrl,
          error_message: engagement ? JSON.stringify(engagement) : null,
        }).eq("id", post.id);
        confirmed++;
      }
    }

    // Se todos confirmados, marca calendário como 'completed'
    const { count: stillScheduled } = await sb
      .from("autopilot_posts")
      .select("id", { count: "exact", head: true })
      .eq("calendar_id", calendarId)
      .eq("status", "scheduled");
    if (!stillScheduled) {
      await sb.from("autopilot_calendars")
        .update({ status: "completed", updated_at: new Date().toISOString() })
        .eq("id", calendarId);
    }
  } catch (e) {
    console.error("[autopilot] confirm error:", e instanceof Error ? e.message : e);
  }

  return { confirmed };
}

// ─── Action: Curate (quality gate + scoring) ────────────────────
// Analisa posts draft com IA e marca os que passam como approved; reescreve os que não passam.

async function handleCurate(calendarId: string) {
  const sb = supabaseAdmin();
  const { data: posts } = await sb
    .from("autopilot_posts")
    .select("id, text_content, platform, hashtags, user_id, calendar_id")
    .eq("calendar_id", calendarId)
    .eq("status", "draft");

  if (!posts?.length) return { curated: 0 };

  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const aiKey = Deno.env.get("OPENAI_API_KEY");
  if (!aiKey) return { curated: 0, error: "OPENAI_API_KEY não configurada" };

  let approved = 0;
  let rewritten = 0;

  for (const post of posts) {
    try {
      // IA avalia: passa (approve) ou reescreve (melhora e aprova)
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${aiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OPENAI_TEXT_MODEL,
          messages: [
            { role: "system", content: `Você é curador de conteúdo. Avalie o post para ${post.platform}. Se estiver BOM (claro, engajador, sem erros, comprimento adequado), responda {"action":"approve"}. Se puder MELHORAR, reescreva e responda {"action":"rewrite","text":"<texto melhorado>"}. Responda APENAS JSON.` },
            { role: "user", content: post.text_content },
          ],
          temperature: 0.3,
          max_tokens: 1024,
        }),
      });

      if (!res.ok) continue;
      const data = await res.json();
      const raw = data.choices?.[0]?.message?.content || "";
      const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

      try {
        const verdict = JSON.parse(cleaned);
        if (verdict.action === "rewrite" && verdict.text) {
          await sb.from("autopilot_posts").update({
            text_content: verdict.text,
            status: "approved",
            updated_at: new Date().toISOString(),
          }).eq("id", post.id);
          rewritten++;
        } else {
          await sb.from("autopilot_posts").update({
            status: "approved",
            updated_at: new Date().toISOString(),
          }).eq("id", post.id);
          approved++;
        }
      } catch {
        // Não conseguiu parsear → aprova como está
        await sb.from("autopilot_posts").update({ status: "approved", updated_at: new Date().toISOString() }).eq("id", post.id);
        approved++;
      }
    } catch (e) {
      console.error(`[autopilot] curate post ${post.id}:`, e instanceof Error ? e.message : e);
    }
  }

  // Se todos curados, atualiza calendário pra approved
  const { count: stillDraft } = await sb
    .from("autopilot_posts")
    .select("id", { count: "exact", head: true })
    .eq("calendar_id", calendarId)
    .eq("status", "draft");
  if (!stillDraft) {
    await sb.from("autopilot_calendars")
      .update({ status: "approved", updated_at: new Date().toISOString() })
      .eq("id", calendarId);
  }

  return { curated: approved + rewritten, approved, rewritten };
}

// ─── Main Handler ───────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // PORTÃO: exige usuário autenticado (ou chamada interna via service_role).
  // Segunda barreira, além do verify_jwt=true no config.toml.
  try {
    await requireUser(req);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 401;
    const message = e instanceof Error ? e.message : "Não autenticado";
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const { action, config_id, calendar_id } = await req.json();

    if (!action) {
      return errorResponse("Missing 'action'", 400);
    }

    // Extract user ID from auth header if present
    const authHeader = req.headers.get("authorization");
    let userId: string | undefined;
    if (authHeader) {
      const sb = supabaseForUser(authHeader);
      const { data: { user } } = await sb.auth.getUser();
      userId = user?.id;
    }

    switch (action) {
      case "generate": {
        if (!config_id) return errorResponse("Missing 'config_id'", 400);
        const result = await handleGenerate(config_id, userId);
        return jsonResponse(result);
      }
      case "schedule": {
        if (!calendar_id) return errorResponse("Missing 'calendar_id'", 400);
        const result = await handleSchedule(calendar_id);
        return jsonResponse(result);
      }
      case "check_visuals": {
        if (!calendar_id) return errorResponse("Missing 'calendar_id'", 400);
        const result = await handleCheckVisuals(calendar_id);
        return jsonResponse(result);
      }
      case "confirm": {
        if (!calendar_id) return errorResponse("Missing 'calendar_id'", 400);
        const result = await handleConfirm(calendar_id);
        return jsonResponse(result);
      }
      case "curate": {
        if (!calendar_id) return errorResponse("Missing 'calendar_id'", 400);
        const result = await handleCurate(calendar_id);
        return jsonResponse(result);
      }
      default:
        return errorResponse(`Unknown action: ${action}`, 400);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    console.error("[autopilot-run] Error:", message);
    return errorResponse(message, 502);
  }
});
