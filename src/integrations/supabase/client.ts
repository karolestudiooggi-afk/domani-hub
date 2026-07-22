import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

/**
 * Cliente Supabase.
 *
 * As credenciais vêm SEMPRE do .env — não há mais fallback embutido no
 * código (o projeto anterior trazia URL e anon key hardcoded, o que amarrava
 * o app a um projeto que não é o seu e vazava o ref no bundle).
 *
 * Preencha no .env:
 *   VITE_SUPABASE_URL=https://SEU-REF.supabase.co
 *   VITE_SUPABASE_PUBLISHABLE_KEY=sua-anon-key
 */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/** true quando temos credenciais reais. A UI usa isso para pedir configuração. */
export const supabaseConfigured = Boolean(
  SUPABASE_URL &&
  SUPABASE_PUBLISHABLE_KEY &&
  !SUPABASE_URL.includes('SEU-') &&
  !SUPABASE_PUBLISHABLE_KEY.includes('sua-'),
);

if (!supabaseConfigured && import.meta.env.DEV) {
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY ausentes. ' +
    'Copie .env.example para .env e preencha com os dados do seu projeto.',
  );
}

// Placeholders evitam que createClient() lance no import e deixe a tela branca.
// Com eles o app RENDERIZA e mostra "não configurado" em vez de morrer.
const url = SUPABASE_URL || 'https://placeholder.supabase.co';
const key = SUPABASE_PUBLISHABLE_KEY || 'placeholder-key';

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith('sb_publishable_') || value.startsWith('sb_secret_');
}

/** As novas API keys do Supabase são strings opacas, não JWTs bearer. */
function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, k) => headers.set(k, value));
    }
    if (isNewSupabaseApiKey(supabaseKey) && headers.get('Authorization') === `Bearer ${supabaseKey}`) {
      headers.delete('Authorization');
    }
    headers.set('apikey', supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

/**
 * Prefixo das tabelas. O Hub usa `hub_` — as tabelas dele vivem no schema
 * `public` (que a API sempre aceita, sem o 406 dos schemas secundários),
 * separadas das do Domani Agentes pelo prefixo.
 *
 *   Hub      → VITE_TABLE_PREFIX="hub_"  → public.hub_brand_profiles
 *   Agentes  → sem a variável            → public.brand_profiles
 */
const TABLE_PREFIX = (import.meta.env.VITE_TABLE_PREFIX as string) || '';

const rawClient = createClient<Database>(url, key, {
  global: { fetch: createSupabaseFetch(key) },
  auth: {
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    persistSession: true,
    autoRefreshToken: true,
  },
});

/**
 * Aplica o prefixo em `.from()` e `.rpc()` de forma transparente: o resto do
 * código continua escrevendo `.from("brand_profiles")` sem saber de nada.
 */
export const supabase = TABLE_PREFIX
  ? (new Proxy(rawClient, {
      get(target, prop, receiver) {
        if (prop === 'from') {
          return (table: string) => target.from(`${TABLE_PREFIX}${table}` as never);
        }
        if (prop === 'rpc') {
          return (fn: string, args?: unknown, opts?: unknown) =>
            (target.rpc as unknown as (f: string, a?: unknown, o?: unknown) => unknown)(
              `${TABLE_PREFIX}${fn}`, args, opts,
            );
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as typeof rawClient)
  : rawClient;
