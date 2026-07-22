/**
 * org.ts — resolução da organização do usuário.
 *
 * Regra atual: quem loga, ganha a própria organização, via a RPC idempotente
 * core.create_org_for_user. Sem instâncias, sem provisionamento por e-mail,
 * sem estado de "acesso negado".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  session: { data: { session: { user: { id: "u1" } } } } as any,
  orgId: "org-1" as string | null,
  rpcError: null as any,
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: vi.fn(async () => h.session) },
    // Tabelas e funções vivem em `public` (schema padrão) — chamada direta,
    // sem .schema(), o que evita o 406 do PostgREST.
    rpc: (fn: string, args: unknown) => {
      h.rpc(fn, args);
      return Promise.resolve({ data: h.orgId, error: h.rpcError });
    },
  },
}));

import { getCurrentOrgId, requireOrgId, invalidateOrgCache, isInstanceAccessDenied } from "./org";

beforeEach(() => {
  invalidateOrgCache();
  h.rpc.mockClear();
  h.session = { data: { session: { user: { id: "u1" } } } };
  h.orgId = "org-1";
  h.rpcError = null;
});

describe("org", () => {
  it("garante a org pessoal via create_org_for_user", async () => {
    await expect(getCurrentOrgId()).resolves.toBe("org-1");
    expect(h.rpc).toHaveBeenCalledWith("create_org_for_user", expect.anything());
  });

  it("faz cache: uma chamada só, mesmo pedindo duas vezes", async () => {
    await getCurrentOrgId();
    await getCurrentOrgId();
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("sem sessão, devolve null e nem chama a RPC", async () => {
    h.session = { data: { session: null } };
    await expect(getCurrentOrgId()).resolves.toBeNull();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("requireOrgId lança quando não há org", async () => {
    h.session = { data: { session: null } };
    await expect(requireOrgId()).rejects.toThrow(/Sem organização/);
  });

  it("não existe mais bloqueio por instância", () => {
    expect(isInstanceAccessDenied()).toBe(false);
  });
});
