/**
 * ID ÚNICO — funciona em qualquer contexto
 *
 * `crypto.randomUUID()` só existe em contexto seguro (HTTPS ou localhost).
 * Servindo o app por HTTP num IP — como acontece antes do domínio com SSL
 * ficar pronto — ele simplesmente não existe, e a chamada quebra com
 * "crypto.randomUUID is not a function".
 *
 * Esta função usa o nativo quando disponível e cai num gerador próprio
 * (compatível com UUID v4) quando não. Assim o app funciona igual nos dois.
 */
export function uuid(): string {
  // Caminho feliz: contexto seguro, usa o nativo.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  // Fallback com bytes aleatórios de verdade, se houver.
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; // versão 4
    b[8] = (b[8] & 0x3f) | 0x80; // variante
    const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // Último recurso: Math.random. Suficiente para nome de arquivo.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
