/**
 * Internals compartilhados da camada de API (chamadas às Edge Functions).
 *
 * MUDANÇA IMPORTANTE: `baseHeaders()` agora envia o TOKEN DA SESSÃO do
 * usuário, não a anon key. As Edge Functions passaram a exigir um usuário
 * autenticado de verdade (antes qualquer um na internet chamava e gastava a
 * chave de IA do dono). Como consequência, `baseHeaders()` virou async.
 *
 * As credenciais vêm do .env — sem fallback embutido no código.
 */

import { supabase } from "@/integrations/supabase/client";
import { userStorage } from "@/lib/storage";
import type { AppConfig } from "@/types";

export function getSupabaseUrl(): string {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!url) {
    throw new Error(
      "VITE_SUPABASE_URL não configurada. Copie .env.example para .env e preencha.",
    );
  }
  return url.replace(/\/$/, "");
}

export function getAnonKey(): string {
  const key =
    (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
    (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined);
  if (!key) {
    throw new Error(
      "VITE_SUPABASE_PUBLISHABLE_KEY não configurada. Copie .env.example para .env e preencha.",
    );
  }
  return key;
}

/** Config do usuário salva no localStorage (chaves de API, etc). */
export function getSavedConfig(): Partial<AppConfig> {
  try {
    const raw = userStorage.get("config");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Headers para chamar uma Edge Function.
 * `apikey` identifica o projeto; `Authorization` carrega o JWT do usuário
 * logado — é ele que a função valida antes de gastar qualquer token pago.
 *
 * As chaves de serviço salvas no painel (Configurações) seguem junto, cada
 * uma no seu header. A função tenta primeiro o header e, se vier vazio, cai
 * no secret do servidor. Assim o painel funciona de verdade, e o secret
 * continua servindo de reserva.
 */
export async function baseHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error("Sessão expirada. Faça login novamente.");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: getAnonKey(),
    Authorization: `Bearer ${token}`,
  };

  // Chaves do painel → headers que as funções reconhecem.
  const cfg = getSavedConfig();
  const mapa: Array<[keyof AppConfig, string]> = [
    ["openaiApiKey", "x-openai-api-key"],
    ["postformeApiKey", "x-pfm-api-key"],
    ["pexelsApiKey", "x-pexels-api-key"],
    ["apifyApiToken", "x-apify-api-token"],
    ["firecrawlApiKey", "x-firecrawl-api-key"],
    ["higgsFieldApiId", "x-higgsfield-api-id"],
    ["higgsFieldApiSecret", "x-higgsfield-api-secret"],
  ];
  for (const [campo, header] of mapa) {
    const valor = String(cfg[campo] ?? "").trim();
    if (valor) headers[header] = valor;
  }

  return headers;
}

/** URL completa de uma Edge Function pelo nome da pasta em supabase/functions/. */
export function fnUrl(name: string): string {
  return `${getSupabaseUrl()}/functions/v1/${name}`;
}
