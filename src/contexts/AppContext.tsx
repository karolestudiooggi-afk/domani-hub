import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import type { AppConfig, SocialAccount, ScheduledPost } from "@/types";
import { userStorage } from "@/lib/storage";
import { supabase } from "@/integrations/supabase/client";
import { getPfmUserKey, setPfmUserKey } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { requireOrgId } from "@/lib/org";

interface AppState {
  config: AppConfig;
  accounts: SocialAccount[];
  schedules: ScheduledPost[];
  isConfigured: boolean;
  onboardingCompleted: boolean;
  configLoading: boolean;
}

interface AppContextType extends AppState {
  setConfig: (config: AppConfig) => void;
  setAccounts: (accounts: SocialAccount[]) => void;
  setSchedules: (schedules: ScheduledPost[]) => void;
  resetConfig: () => void;
  completeOnboarding: (finalConfig?: AppConfig) => void;
  saveConfigToDb: (config: AppConfig) => Promise<AppConfig>;
}

const DEFAULT_CONFIG: AppConfig = {
  brandName: "Domani.AI",
  openaiApiKey: "",
  postformeApiKey: "",
  pexelsApiKey: "",
  apifyApiToken: "",
  higgsFieldApiId: "",
  higgsFieldApiSecret: "",
  firecrawlApiKey: "",
};

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [config, setConfigState] = useState<AppConfig>(() => {
    const saved = userStorage.get("config");
    return saved ? JSON.parse(saved) : DEFAULT_CONFIG;
  });
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [schedules, setSchedules] = useState<ScheduledPost[]>([]);
  const [configLoadingState, setConfigLoading] = useState(true);
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
  const { user, loading: authLoading } = useAuth();

  // Post for Me é a integração core (publicação).
  const isConfigured = !!config.postformeApiKey;
  const onboardingCompleted = !!config.onboardingCompleted;

  // Recarrega config do DB sempre que o usuário autenticado mudar
  // (login, troca de conta, signOut). Sem isso, o config só é lido uma vez
  // antes da sessão hidratar e o app força /setup mesmo em contas já configuradas.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoadedUserId(null);
      setConfigLoading(false);
      return;
    }
    setConfigLoading(true);
    loadConfigFromDb().finally(() => setLoadedUserId(user.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading]);

  // configLoading "real": enquanto o config carregado NÃO for o do usuário atual,
  // considera-se carregando. Fecha a corrida em que, logo após o login, um render
  // intermediário tinha configLoading=false + onboarding=false e mandava um usuário
  // JÁ configurado para /setup em vez de cair no dashboard.
  const configLoading =
    configLoadingState || (!!user && !authLoading && loadedUserId !== user.id);

  async function loadConfigFromDb() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setConfigLoading(false); return; }

      // Busca a config pela ORGANIZAÇÃO, não pelo user_id. É a org que o RLS
      // usa para isolar os dados, e há apenas uma linha de config por org
      // (unique org_id). Buscar por user_id falharia para contas provisionadas
      // por SQL, onde o user_id da config pode estar nulo.
      const orgId = await requireOrgId();
      const { data, error } = await supabase
        .from("user_configs")
        .select("*")
        .eq("org_id", orgId)
        .maybeSingle();

      // Se a QUERY falhou (ex.: schema app_social não exposto na API, coluna
      // faltando por banco desatualizado), NÃO podemos assumir "onboarding
      // incompleto" — isso prenderia o usuário no /setup para sempre. Erramos
      // para o lado de deixar navegar, e logamos a causa real.
      if (error) {
        console.error(
          "[AppContext] erro ao ler user_configs — verifique se os schemas 'core' e 'app_social' " +
          "estão em Settings → API → Exposed schemas, e se o banco está atualizado:",
          error,
        );
        // tenta o cache local do onboarding para não travar
        const cached = userStorage.get("config");
        if (cached) {
          try { setConfigState(JSON.parse(cached)); } catch { /* ignore */ }
        }
        setConfigLoading(false);
        return;
      }

      if (data) {
        const loaded: AppConfig = {
          openaiApiKey: data.openai_api_key || "",
          postformeApiKey: data.postforme_api_key || "",
          pexelsApiKey: data.pexels_api_key || "",
          apifyApiToken: data.apify_api_token || "",
          firecrawlApiKey: data.firecrawl_api_key || "",
          higgsFieldApiId: data.higgsfield_api_id || undefined,
          higgsFieldApiSecret: data.higgsfield_api_secret || undefined,
          brandName: data.brand_name || "Domani.AI",
          brandLogo: data.brand_logo_url || undefined,
          // Onboarding NÃO depende de nenhuma chave de integração. A IA já vem
          // configurada no servidor; Post for Me, Pexels etc. são opcionais e
          // podem ser conectados depois, em Configurações.
          onboardingCompleted: !!data.onboarding_completed,
        };
        setConfigState(loaded);
        userStorage.set("config", JSON.stringify(loaded));
        setPfmUserKey(loaded.postformeApiKey);
      } else {
        // Sem linha no DB: usuário novo OU primeiro login neste browser.
        // Limpa qualquer config residual de outro usuário no mesmo navegador.
        setConfigState(DEFAULT_CONFIG);
        userStorage.set("config", JSON.stringify(DEFAULT_CONFIG));
        setPfmUserKey("");
      }
    } catch (err) {
      // Cai aqui se requireOrgId() falhar — normalmente porque a RPC
      // core.create_org_for_user não é acessível (schema 'core' não exposto
      // na API) ou o banco não foi criado. Logamos a causa em vez de travar
      // silenciosamente.
      console.error(
        "[AppContext] não foi possível resolver a organização. Rode o SQL do banco e exponha " +
        "os schemas 'core' e 'app_social' em Settings → API:",
        err,
      );
    } finally {
      setConfigLoading(false);
    }
  }

  async function saveConfigToDb(cfg: AppConfig) {
    const hasPostformeApiKey = Object.prototype.hasOwnProperty.call(cfg, "postformeApiKey");
    const cfgAlias = cfg as AppConfig & { pfmApiKey?: string };
    const hasLegacyPfmApiKey = Object.prototype.hasOwnProperty.call(cfgAlias, "pfmApiKey");
    const nextPostformeApiKey = hasPostformeApiKey
      ? (cfg.postformeApiKey ?? "")
      : hasLegacyPfmApiKey
        ? (cfgAlias.pfmApiKey ?? "")
        : (config.postformeApiKey || getPfmUserKey() || "");

    const nextConfig: AppConfig = {
      ...cfg,
      postformeApiKey: nextPostformeApiKey,
      onboardingCompleted: cfg.onboardingCompleted || config.onboardingCompleted || false,
    };

    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("Usuário não autenticado.");

      const row = {
        user_id: user.id,
        openai_api_key: nextConfig.openaiApiKey || null,
        postforme_api_key: nextConfig.postformeApiKey || null,
        pexels_api_key: nextConfig.pexelsApiKey || null,
        apify_api_token: nextConfig.apifyApiToken || null,
        firecrawl_api_key: nextConfig.firecrawlApiKey || null,
        higgsfield_api_id: nextConfig.higgsFieldApiId || null,
        higgsfield_api_secret: nextConfig.higgsFieldApiSecret || null,
        brand_name: nextConfig.brandName || "Domani.AI",
        brand_logo_url: nextConfig.brandLogo || null,
        onboarding_completed: nextConfig.onboardingCompleted || false,
      };

      // Upsert pela ORGANIZAÇÃO (há uma linha de config por org — unique org_id).
      const org_id = await requireOrgId();
      const { data: existing, error: lookupError } = await supabase
        .from("user_configs")
        .select("id")
        .eq("org_id", org_id)
        .maybeSingle();

      if (lookupError) throw lookupError;

      if (existing) {
        const { error } = await supabase
          .from("user_configs")
          .update({ ...row, user_id: user.id })
          .eq("org_id", org_id);
        if (error) throw error;
      } else {
        // A RLS de user_configs exige core.is_org_member(org_id).
        const { error } = await supabase
          .from("user_configs")
          .insert({ ...row, org_id, user_id: user.id });
        if (error) throw error;
      }

      setConfigState(nextConfig);
      userStorage.set("config", JSON.stringify(nextConfig));
      setPfmUserKey(nextConfig.postformeApiKey);
      return nextConfig;
    } catch (err) {
      console.error("Failed to save config to DB:", err);
      throw err;
    }
  }

  const setConfig = (newConfig: AppConfig) => {
    setConfigState(newConfig);
    userStorage.set("config", JSON.stringify(newConfig));
    setPfmUserKey(newConfig.postformeApiKey);
  };

  const completeOnboarding = (finalConfig?: AppConfig) => {
    const updated = { ...(finalConfig ?? config), onboardingCompleted: true };
    setConfigState(updated);
    userStorage.set("config", JSON.stringify(updated));
    setPfmUserKey(updated.postformeApiKey);
  };

  const resetConfig = () => {
    setConfigState(DEFAULT_CONFIG);
    userStorage.remove("config");
    setAccounts([]);
    setSchedules([]);
  };

  return (
    <AppContext.Provider
      value={{
        config,
        accounts,
        schedules,
        isConfigured,
        onboardingCompleted,
        configLoading,
        setConfig,
        setAccounts,
        setSchedules,
        resetConfig,
        completeOnboarding,
        saveConfigToDb,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used within AppProvider");
  return context;
}
