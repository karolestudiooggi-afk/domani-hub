/**
 * Mock auth para navegação/preview antes das chaves reais.
 *
 * Enquanto MOCK_AUTH=true, o AuthContext ignora o Supabase e mantém uma
 * "sessão" fake em localStorage. Qualquer email/senha loga. Também bypassa o
 * RequireOnboarding para permitir navegar por todas as telas sem chaves.
 *
 * Para voltar ao modo real: mude MOCK_AUTH para false.
 */
export const MOCK_AUTH = true;

const KEY = "mock_auth_user";

export type MockUser = {
  id: string;
  email: string;
  full_name?: string;
};

export function getMockUser(): MockUser | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as MockUser) : null;
  } catch {
    return null;
  }
}

export function setMockUser(email: string, full_name?: string): MockUser {
  const user: MockUser = {
    id: `mock-${btoa(email).replace(/=/g, "")}`,
    email,
    full_name,
  };
  localStorage.setItem(KEY, JSON.stringify(user));
  return user;
}

export function clearMockUser() {
  localStorage.removeItem(KEY);
}
