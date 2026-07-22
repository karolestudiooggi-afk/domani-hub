import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRight, ArrowLeft, Loader2, AlertCircle, Link2, CheckCircle2,
  Image as ImageIcon, BarChart3, Palette, Film, Search, Mail, Save, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useApp } from "@/contexts/AppContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  getPfmUserKey,
  validatePfmKey,
  validateApifyToken,
  validateHiggsFieldKey,
  validateFirecrawlKey,
  validatePexelsKey,
} from "@/lib/api";
import { ConnectAccountDialog } from "@/components/ConnectAccountDialog";
import { SecretInput } from "@/components/setup/SecretInput";
import { DomaniLogo } from "@/components/DomaniLogo";
import type { AppConfig } from "@/types";

const AuthHalo = () => (
  <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
    <div className="absolute -top-32 left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-primary/[0.08] blur-3xl" />
    <div className="absolute bottom-0 right-0 h-[320px] w-[320px] rounded-full bg-primary/[0.06] blur-3xl" />
  </div>
);

const PLATFORMS = [
  "Instagram", "Twitter/X", "Facebook", "LinkedIn",
  "TikTok", "Pinterest", "Threads", "YouTube", "Bluesky",
];

type Status = "idle" | "validating" | "valid" | "error";

export default function Setup() {
  const {
    config, setConfig, onboardingCompleted, configLoading,
    completeOnboarding, saveConfigToDb, resetConfig, accounts,
  } = useApp();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();

  const hasAnySavedConfig = !!(
    config.postformeApiKey || config.apifyApiToken || config.firecrawlApiKey ||
    config.higgsFieldApiId || config.higgsFieldApiSecret || config.pexelsApiKey
  );
  // O modo "gerenciar" (Central de Conexões) só abre quando o usuário pede
  // explicitamente, com ?manage=1. Caso contrário, se o onboarding já está
  // concluído, o lugar dele é o DASHBOARD — não esta tela.
  const wantsManage = searchParams.get("manage") === "1";
  const isManageMode = wantsManage && (onboardingCompleted || hasAnySavedConfig);

  // Reset demo
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("reset") === "1") {
      resetConfig();
      window.history.replaceState({}, "", "/setup");
    }
  }, [resetConfig]);

  // Onboarding já concluído e o usuário NÃO pediu o modo gerenciar → dashboard.
  useEffect(() => {
    if (!configLoading && onboardingCompleted && !wantsManage && searchParams.get("reset") !== "1") {
      navigate("/dashboard", { replace: true });
    }
  }, [configLoading, onboardingCompleted, wantsManage, navigate, searchParams]);

  // ── Estado dos campos ─────────────────────────────────────
  const [brandName, setBrandName]       = useState(config.brandName || "");
  const [pfmKey, setPfmKey]             = useState(config.postformeApiKey || "");
  const [hfApiId, setHfApiId]           = useState(config.higgsFieldApiId || "");
  const [hfApiSecret, setHfApiSecret]   = useState(config.higgsFieldApiSecret || "");
  const [apifyToken, setApifyToken]     = useState(config.apifyApiToken || "");
  const [firecrawlKey, setFirecrawlKey] = useState(config.firecrawlApiKey || "");
  const [pexelsKey, setPexelsKey]       = useState(config.pexelsApiKey || "");

  const [status, setStatus] = useState<Record<string, Status>>({
    pfm: config.postformeApiKey ? "valid" : "idle",
    hf: (config.higgsFieldApiId && config.higgsFieldApiSecret) ? "valid" : "idle",
    apify: config.apifyApiToken ? "valid" : "idle",
    firecrawl: config.firecrawlApiKey ? "valid" : "idle",
    pexels: config.pexelsApiKey ? "valid" : "idle",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [connectOpen, setConnectOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Sincroniza os campos sempre que a configuração carregada mudar
  // (inclui troca de conta no mesmo navegador).
  useEffect(() => {
    if (configLoading) return;
    setBrandName(config.brandName || "");
    setPfmKey(config.postformeApiKey || "");
    setHfApiId(config.higgsFieldApiId || "");
    setHfApiSecret(config.higgsFieldApiSecret || "");
    setApifyToken(config.apifyApiToken || "");
    setFirecrawlKey(config.firecrawlApiKey || "");
    setPexelsKey(config.pexelsApiKey || "");
    setStatus({
      pfm: config.postformeApiKey ? "valid" : "idle",
      hf: (config.higgsFieldApiId && config.higgsFieldApiSecret) ? "valid" : "idle",
      apify: config.apifyApiToken ? "valid" : "idle",
      firecrawl: config.firecrawlApiKey ? "valid" : "idle",
      pexels: config.pexelsApiKey ? "valid" : "idle",
    });
  }, [configLoading, config]);

  const setKeyStatus = (k: string, s: Status, err?: string) => {
    setStatus((prev) => ({ ...prev, [k]: s }));
    setErrors((prev) => ({ ...prev, [k]: err || "" }));
  };

  const persistPartial = async (partial: Partial<AppConfig>) => {
    const updated: AppConfig = { ...config, ...partial };
    const saved = await saveConfigToDb(updated);
    setConfig(saved);
    return saved;
  };

  // ── Validadores inline ────────────────────────────────────
  const validatePfm = async () => {
    if (!pfmKey.trim()) return;
    setKeyStatus("pfm", "validating");
    try {
      const r = await validatePfmKey(pfmKey.trim());
      if (!r.valid) return setKeyStatus("pfm", "error", r.error || "Chave inválida");
      await persistPartial({ postformeApiKey: pfmKey.trim() });
      setKeyStatus("pfm", "valid");
      toast({ title: "Post for Me conectado!" });
    } catch (e) {
      setKeyStatus("pfm", "error", e instanceof Error ? e.message : "Erro ao validar");
    }
  };

  const validateHf = async () => {
    if (!hfApiId.trim() || !hfApiSecret.trim()) return;
    setKeyStatus("hf", "validating");
    try {
      const r = await validateHiggsFieldKey(hfApiId.trim(), hfApiSecret.trim());
      if (!r.valid) return setKeyStatus("hf", "error", r.error || "Credenciais inválidas");
      await persistPartial({ higgsFieldApiId: hfApiId.trim(), higgsFieldApiSecret: hfApiSecret.trim() });
      setKeyStatus("hf", "valid");
      toast({ title: "Higgsfield conectado!" });
    } catch (e) {
      setKeyStatus("hf", "error", e instanceof Error ? e.message : "Erro ao validar");
    }
  };

  const validateApify = async () => {
    if (!apifyToken.trim()) return;
    setKeyStatus("apify", "validating");
    try {
      const r = await validateApifyToken(apifyToken.trim());
      if (!r.valid) return setKeyStatus("apify", "error", r.error || "Token inválido");
      await persistPartial({ apifyApiToken: apifyToken.trim() });
      setKeyStatus("apify", "valid");
      toast({ title: "Apify conectado!" });
    } catch (e) {
      setKeyStatus("apify", "error", e instanceof Error ? e.message : "Erro ao validar");
    }
  };

  const validateFirecrawl = async () => {
    if (!firecrawlKey.trim()) return;
    setKeyStatus("firecrawl", "validating");
    try {
      const r = await validateFirecrawlKey(firecrawlKey.trim());
      if (!r.valid) return setKeyStatus("firecrawl", "error", r.error || "Chave inválida");
      await persistPartial({ firecrawlApiKey: firecrawlKey.trim() });
      setKeyStatus("firecrawl", "valid");
      toast({ title: "Firecrawl conectado!" });
    } catch (e) {
      setKeyStatus("firecrawl", "error", e instanceof Error ? e.message : "Erro ao validar");
    }
  };

  const validatePexels = async () => {
    if (!pexelsKey.trim()) return;
    setKeyStatus("pexels", "validating");
    try {
      const r = await validatePexelsKey(pexelsKey.trim());
      if (!r.valid) return setKeyStatus("pexels", "error", r.error || "Chave inválida");
      await persistPartial({ pexelsApiKey: pexelsKey.trim() });
      setKeyStatus("pexels", "valid");
      toast({ title: "Pexels conectado!" });
    } catch (e) {
      setKeyStatus("pexels", "error", e instanceof Error ? e.message : "Erro ao validar");
    }
  };

  // ── Remover chave ─────────────────────────────────────────
  const removeKey = async (which: "pfm" | "hf" | "apify" | "firecrawl" | "pexels") => {
    if (!confirm("Remover essa credencial? As funcionalidades dependentes serão desativadas.")) return;
    const patch: Partial<AppConfig> =
      which === "pfm" ? { postformeApiKey: "" }
      : which === "hf" ? { higgsFieldApiId: undefined, higgsFieldApiSecret: undefined }
      : which === "apify" ? { apifyApiToken: undefined }
      : which === "firecrawl" ? { firecrawlApiKey: undefined }
      : { pexelsApiKey: undefined };
    await persistPartial(patch);
    if (which === "pfm") setPfmKey("");
    if (which === "hf") { setHfApiId(""); setHfApiSecret(""); }
    if (which === "apify") setApifyToken("");
    if (which === "firecrawl") setFirecrawlKey("");
    if (which === "pexels") setPexelsKey("");
    setKeyStatus(which, "idle");
    toast({ title: "Credencial removida" });
  };

  const saveBrand = async () => {
    if (!brandName.trim()) return;
    await persistPartial({ brandName: brandName.trim() });
    toast({ title: "Marca salva" });
  };

  // ── Concluir ──────────────────────────────────────────────
  const handleFinish = async () => {
    // Nenhuma chave é obrigatória para concluir. A IA já vem configurada no
    // servidor; Post for Me, Pexels etc. são opcionais e podem ser conectados
    // depois, em Configurações. O importante é registrar que o onboarding acabou.
    setIsSaving(true);
    try {
      const finalConfig: AppConfig = {
        ...config,
        postformeApiKey: pfmKey.trim() || config.postformeApiKey || (config as { pfmApiKey?: string }).pfmApiKey || getPfmUserKey(),
        pexelsApiKey: pexelsKey.trim() || config.pexelsApiKey,
        apifyApiToken: apifyToken.trim() || config.apifyApiToken,
        higgsFieldApiId: hfApiId.trim() || config.higgsFieldApiId,
        higgsFieldApiSecret: hfApiSecret.trim() || config.higgsFieldApiSecret,
        firecrawlApiKey: firecrawlKey.trim() || config.firecrawlApiKey,
        brandName: brandName || config.brandName,
        onboardingCompleted: true,
      };
      const saved = await saveConfigToDb(finalConfig);
      setConfig(saved);
      completeOnboarding(saved);
      toast({ title: isManageMode ? "Alterações salvas!" : "Configuração concluída!" });
      navigate("/dashboard");
    } catch (err) {
      // Mostra a causa real (ajuda a diagnosticar: coluna faltando, schema não
      // exposto, RLS, etc.) em vez de um "Erro desconhecido" genérico.
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Setup] falha ao salvar config:", err);
      toast({
        title: "Não foi possível salvar no servidor",
        description: msg || "Verifique se o banco foi criado e os schemas core e app_social estão expostos em Settings → API.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (configLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center relative overflow-hidden">
        <AuthHalo />
        <Loader2 className="h-8 w-8 animate-spin text-primary relative z-10" />
      </div>
    );
  }

  const StatusBadge = ({ s }: { s: Status }) => {
    if (s === "valid") return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px] px-1.5 py-0 h-4">Conectado</Badge>;
    if (s === "validating") return <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4"><Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" />Validando</Badge>;
    if (s === "error") return <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4">Erro</Badge>;
    return <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">Não configurado</Badge>;
  };

  const connectedPlatforms = new Set(accounts.map((a) => a.platform));

  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8 relative overflow-hidden">
      <AuthHalo />
      <div className="mx-auto max-w-3xl space-y-6 relative z-10">

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <DomaniLogo size={56} variant="laranja" />
            <div>
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
                Central de <span className="text-gradient-domani">Conexões</span>
              </h1>
              <p className="text-sm text-muted-foreground">
                {isManageMode ? "Atualize suas integrações a qualquer momento" : "Configure a plataforma em um só lugar"}
              </p>
              {user?.email && (
                <div className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Mail className="h-3.5 w-3.5" />
                  <span className="font-medium text-foreground">{user.email}</span>
                </div>
              )}
            </div>
          </div>
          {isManageMode && (
            <Button variant="outline" onClick={() => navigate("/dashboard")}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
            </Button>
          )}
        </div>

        {/* ── 1. SUA MARCA ─────────────────────────────────── */}
        <Card className="card-premium">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Palette className="h-5 w-5 text-primary" /> Sua marca
            </CardTitle>
            <CardDescription>
              Nome que aparece na plataforma e nos posts gerados por IA.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="brand">Nome da marca / agência</Label>
              <div className="flex gap-2">
                <Input
                  id="brand"
                  placeholder="Minha Agência Digital"
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                />
                <Button
                  variant="outline"
                  onClick={saveBrand}
                  disabled={!brandName.trim() || brandName.trim() === (config.brandName || "")}
                >
                  <Save className="h-4 w-4 mr-1" /> Salvar
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── 2. SUAS REDES ─────────────────────────────────── */}
        <Card className="card-premium">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Link2 className="h-5 w-5 text-primary" /> Suas redes
              {accounts.length > 0 && (
                <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px] px-1.5 py-0 h-4">
                  {accounts.length} conectada{accounts.length > 1 ? "s" : ""}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Autorize as redes que deseja publicar e analisar.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {PLATFORMS.map((p) => {
                const on = connectedPlatforms.has(p as never);
                return (
                  <div
                    key={p}
                    className={`flex items-center justify-center rounded-lg border px-2 py-2 text-xs text-center transition-colors ${
                      on ? "bg-green-500/10 border-green-500/40 text-green-700 font-medium" : "bg-muted/30 text-muted-foreground"
                    }`}
                  >
                    {on && <CheckCircle2 className="h-3 w-3 mr-1 text-green-600" />}
                    {p}
                  </div>
                );
              })}
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setConnectOpen(true)}
              disabled={!config.postformeApiKey && !pfmKey.trim()}
            >
              <Link2 className="mr-2 h-4 w-4" />
              {accounts.length > 0 ? "Conectar mais redes" : "Conectar redes sociais"}
            </Button>
            {!config.postformeApiKey && (
              <p className="text-xs text-muted-foreground text-center">
                Configure a Post for Me abaixo para habilitar a conexão de redes.
              </p>
            )}
          </CardContent>
        </Card>

        {/* ── 3. PUBLICAÇÃO ESSENCIAL — POST FOR ME ───────── */}
        <Card className="card-premium">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Link2 className="h-5 w-5 text-primary" /> Post for Me — Publicação
                </CardTitle>
                <CardDescription>
                  Publica em 9 redes, agenda posts e gerencia contas. Opcional — conecte quando for publicar.
                </CardDescription>
              </div>
              <StatusBadge s={status.pfm} />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <SecretInput
              id="pfm" label="Post for Me API Key" placeholder="pfm_live_xxxxxxxxxxxxx"
              value={pfmKey} onChange={(v) => { setPfmKey(v); setKeyStatus("pfm", "idle"); }}
              hint="Obtenha em" link="https://app.postforme.dev/settings" linkLabel="app.postforme.dev/settings"
            />
            {errors.pfm && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {errors.pfm}
              </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              {isManageMode && config.postformeApiKey && (
                <Button variant="outline" onClick={() => removeKey("pfm")}>
                  <Trash2 className="mr-2 h-4 w-4" /> Remover
                </Button>
              )}
              <Button
                className="flex-1 bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-500/90 hover:to-amber-600/90"
                onClick={validatePfm}
                disabled={!pfmKey.trim() || status.pfm === "validating"}
              >
                {status.pfm === "validating" ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Validando...</>
                  : status.pfm === "valid" ? <><CheckCircle2 className="mr-2 h-4 w-4" />Revalidar / atualizar</>
                  : <>Validar e conectar</>}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ── 4. RECURSOS AVANÇADOS (accordion) ──────────── */}
        <Card className="card-premium">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recursos avançados</CardTitle>
            <CardDescription>Integrações opcionais — habilite conforme precisar.</CardDescription>
          </CardHeader>
          <CardContent>
            <Accordion type="multiple" className="w-full">
              {/* HIGGSFIELD */}
              <AccordionItem value="hf">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-2 flex-1">
                    <Film className="h-4 w-4 text-orange-500" />
                    <span className="font-medium">Higgsfield</span>
                    <span className="text-xs text-muted-foreground">— Vídeo IA</span>
                    <div className="ml-auto mr-2"><StatusBadge s={status.hf} /></div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-3 pt-2">
                  <SecretInput
                    id="hf-id" label="API ID" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    value={hfApiId} onChange={(v) => { setHfApiId(v); setKeyStatus("hf", "idle"); }}
                    hint="Obtenha em" link="https://cloud.higgsfield.ai/settings" linkLabel="cloud.higgsfield.ai"
                  />
                  <SecretInput
                    id="hf-secret" label="API Secret" placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    value={hfApiSecret} onChange={(v) => { setHfApiSecret(v); setKeyStatus("hf", "idle"); }}
                  />
                  {errors.hf && <p className="text-xs text-destructive flex items-start gap-1"><AlertCircle className="h-3 w-3 mt-0.5" />{errors.hf}</p>}
                  <div className="flex gap-2">
                    {status.hf === "valid" && (
                      <Button variant="outline" size="sm" onClick={() => removeKey("hf")}>
                        <Trash2 className="h-3.5 w-3.5 mr-1" /> Remover
                      </Button>
                    )}
                    <Button size="sm" className="ml-auto" onClick={validateHf}
                      disabled={!hfApiId.trim() || !hfApiSecret.trim() || status.hf === "validating"}>
                      {status.hf === "validating" ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                      Validar e salvar
                    </Button>
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* APIFY */}
              <AccordionItem value="apify">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-2 flex-1">
                    <BarChart3 className="h-4 w-4 text-green-500" />
                    <span className="font-medium">Apify</span>
                    <span className="text-xs text-muted-foreground">— Analytics reais</span>
                    <div className="ml-auto mr-2"><StatusBadge s={status.apify} /></div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-3 pt-2">
                  <SecretInput
                    id="apify" label="Apify API Token" placeholder="apify_api_xxxxxxxxxxxxx"
                    value={apifyToken} onChange={(v) => { setApifyToken(v); setKeyStatus("apify", "idle"); }}
                    hint="Crie conta grátis em" link="https://console.apify.com/account/integrations" linkLabel="console.apify.com"
                  />
                  {errors.apify && <p className="text-xs text-destructive flex items-start gap-1"><AlertCircle className="h-3 w-3 mt-0.5" />{errors.apify}</p>}
                  <div className="flex gap-2">
                    {status.apify === "valid" && (
                      <Button variant="outline" size="sm" onClick={() => removeKey("apify")}>
                        <Trash2 className="h-3.5 w-3.5 mr-1" /> Remover
                      </Button>
                    )}
                    <Button size="sm" className="ml-auto" onClick={validateApify}
                      disabled={!apifyToken.trim() || status.apify === "validating"}>
                      {status.apify === "validating" ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                      Validar e salvar
                    </Button>
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* FIRECRAWL */}
              <AccordionItem value="firecrawl">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-2 flex-1">
                    <Search className="h-4 w-4 text-orange-500" />
                    <span className="font-medium">Firecrawl</span>
                    <span className="text-xs text-muted-foreground">— Pesquisa & fontes</span>
                    <div className="ml-auto mr-2"><StatusBadge s={status.firecrawl} /></div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-3 pt-2">
                  <SecretInput
                    id="firecrawl" label="Firecrawl API Key" placeholder="fc-xxxxxxxxxxxxx"
                    value={firecrawlKey} onChange={(v) => { setFirecrawlKey(v); setKeyStatus("firecrawl", "idle"); }}
                    hint="Crie conta em" link="https://www.firecrawl.dev/app/api-keys" linkLabel="firecrawl.dev"
                  />
                  {errors.firecrawl && <p className="text-xs text-destructive flex items-start gap-1"><AlertCircle className="h-3 w-3 mt-0.5" />{errors.firecrawl}</p>}
                  <div className="flex gap-2">
                    {status.firecrawl === "valid" && (
                      <Button variant="outline" size="sm" onClick={() => removeKey("firecrawl")}>
                        <Trash2 className="h-3.5 w-3.5 mr-1" /> Remover
                      </Button>
                    )}
                    <Button size="sm" className="ml-auto" onClick={validateFirecrawl}
                      disabled={!firecrawlKey.trim() || status.firecrawl === "validating"}>
                      {status.firecrawl === "validating" ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                      Validar e salvar
                    </Button>
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* PEXELS */}
              <AccordionItem value="pexels">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-2 flex-1">
                    <ImageIcon className="h-4 w-4 text-blue-500" />
                    <span className="font-medium">Pexels</span>
                    <span className="text-xs text-muted-foreground">— Banco de imagens</span>
                    <div className="ml-auto mr-2"><StatusBadge s={status.pexels} /></div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-3 pt-2">
                  <SecretInput
                    id="pexels" label="Pexels API Key" placeholder="Sua chave Pexels"
                    value={pexelsKey} onChange={(v) => { setPexelsKey(v); setKeyStatus("pexels", "idle"); }}
                    hint="Crie conta grátis em" link="https://www.pexels.com/api/" linkLabel="pexels.com/api"
                  />
                  {errors.pexels && <p className="text-xs text-destructive flex items-start gap-1"><AlertCircle className="h-3 w-3 mt-0.5" />{errors.pexels}</p>}
                  <div className="flex gap-2">
                    {status.pexels === "valid" && (
                      <Button variant="outline" size="sm" onClick={() => removeKey("pexels")}>
                        <Trash2 className="h-3.5 w-3.5 mr-1" /> Remover
                      </Button>
                    )}
                    <Button size="sm" className="ml-auto" onClick={validatePexels}
                      disabled={!pexelsKey.trim() || status.pexels === "validating"}>
                      {status.pexels === "validating" ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                      Validar e salvar
                    </Button>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>

        {/* ── Footer / Concluir ─────────────────────────────── */}
        <div className="sticky bottom-4 z-20 space-y-2">
          <Button
            className="w-full h-12 bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-500/90 hover:to-amber-600/90 shadow-xl shadow-orange-500/20 text-base"
            onClick={handleFinish}
            disabled={isSaving}
          >
            {isSaving ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" />Salvando...</>
              : isManageMode ? <>Salvar alterações <ArrowRight className="ml-2 h-5 w-5" /></>
              : <>Concluir e ir para o Dashboard <ArrowRight className="ml-2 h-5 w-5" /></>}
          </Button>

          {/* Escape: marca o onboarding como concluído SÓ no navegador e
              navega. Garante que ninguém fique preso aqui mesmo se o save no
              servidor falhar (banco desatualizado, schema não exposto, etc). */}
          {!isManageMode && (
            <Button
              variant="ghost"
              className="w-full h-9 text-sm text-muted-foreground"
              disabled={isSaving}
              onClick={() => {
                completeOnboarding({ ...config, onboardingCompleted: true });
                navigate("/dashboard");
              }}
            >
              Pular por agora e ir para o Dashboard
            </Button>
          )}
        </div>

        <ConnectAccountDialog open={connectOpen} onOpenChange={setConnectOpen} />
      </div>
    </div>
  );
}
