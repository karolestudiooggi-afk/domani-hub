import { supabase } from "@/integrations/supabase/client";

/**
 * Resolve a organização do usuário logado.
 *
 * Todo dado do app (marcas, criações, posts, autopilot) pertence a uma
 * organização — é o que o RLS usa para isolar os dados.
 *
 * Regra, simples de propósito: **quem loga, ganha a própria organização.**
 * A RPC `core.create_org_for_user` é idempotente — se já existe, devolve a
 * mesma; se não, cria e vira admin dela.
 *
 * (A versão anterior dependia de "instâncias" pré-provisionadas por e-mail:
 * se não houvesse uma reservada pra você, o app travava em "aguardando
 * acesso" e nada funcionava. Isso saiu.)
 *
 * Cacheado + single-flight; o cache é limpo no logout.
 */

const ORG_NAME = (import.meta.env.VITE_ORG_NAME as string) || "Domani";

let _orgIdCache: string | null = null;
let _orgIdPromise: Promise<string | null> | null = null;

export function invalidateOrgCache() {
  _orgIdCache = null;
  _orgIdPromise = null;
}

/** Mantido por compatibilidade com telas que checavam bloqueio de acesso. */
export function isInstanceAccessDenied(): boolean {
  return false;
}

async function resolveOrgId(): Promise<string | null> {
  const { data: sess } = await supabase.auth.getSession();
  if (!sess.session?.user?.id) return null;

  const { data, error } = await supabase
    .rpc("create_org_for_user", { _name: ORG_NAME });

  if (error) throw error;
  return (data as string | null) ?? null;
}

export async function getCurrentOrgId(): Promise<string | null> {
  if (_orgIdCache) return _orgIdCache;
  if (_orgIdPromise) return _orgIdPromise;

  _orgIdPromise = resolveOrgId()
    .then((id) => {
      _orgIdCache = id;
      return id;
    })
    .catch((e) => {
      _orgIdPromise = null;
      throw e;
    });

  return _orgIdPromise;
}

export async function requireOrgId(): Promise<string> {
  const id = await getCurrentOrgId();
  if (!id) throw new Error("Sem organização para o usuário atual (sessão expirada?).");
  return id;
}
