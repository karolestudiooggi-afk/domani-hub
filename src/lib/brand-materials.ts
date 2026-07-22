/**
 * MATERIAIS DA MARCA COMO CONTEXTO DA IA
 *
 * O cliente sobe textos, links e documentos na tela "Marca". Este módulo
 * transforma esse material em contexto que vai junto no pedido à IA —
 * é o que faz o conteúdo sair com os fatos reais da empresa, e não genérico.
 */
import { supabase } from "@/integrations/supabase/client";
import { requireOrgId } from "@/lib/org";

export type MaterialResumo = {
  titulo: string;
  tipo: string;
};

export type ContextoMateriais = {
  /** Texto pronto para injetar no prompt. Vazio se não houver material. */
  texto: string;
  /** Nomes dos materiais usados — para mostrar no log de atividade. */
  usados: MaterialResumo[];
};

/**
 * Busca os materiais textuais da marca (copy e links) e monta o bloco de
 * contexto. Imagens e documentos entram apenas como menção — a IA não lê
 * o arquivo, mas sabe que existe e do que se trata pela observação.
 */
export async function carregarContextoDaMarca(brandId?: string | null): Promise<ContextoMateriais> {
  try {
    const orgId = await requireOrgId();
    let q = supabase
      .from("brand_materials")
      .select("kind, title, content, file_name")
      .eq("org_id", orgId);
    // Multi-cliente: só o material do cliente em questão alimenta a IA dele.
    if (brandId) q = q.eq("brand_id", brandId);
    const { data, error } = await q
      .order("created_at", { ascending: false })
      .limit(40);

    if (error || !data?.length) return { texto: "", usados: [] };

    const usados: MaterialResumo[] = [];
    const linhas: string[] = [];

    for (const m of data) {
      const titulo = String(m.title ?? "").trim();
      const conteudo = String(m.content ?? "").trim();
      if (!titulo) continue;

      usados.push({ titulo, tipo: String(m.kind) });

      if (m.kind === "copy" && conteudo) {
        linhas.push(`• ${titulo}:\n${conteudo}`);
      } else if (m.kind === "link" && conteudo) {
        linhas.push(`• ${titulo} (referência): ${conteudo}`);
      } else if (conteudo) {
        // imagem/documento com observação
        linhas.push(`• ${titulo} (${m.kind}): ${conteudo}`);
      } else {
        linhas.push(`• ${titulo} (${m.kind} disponível no acervo da marca)`);
      }
    }

    if (!linhas.length) return { texto: "", usados };

    const texto = [
      "MATERIAIS OFICIAIS DA MARCA (enviados pelo cliente — use como fonte de verdade;",
      "prefira estes fatos a qualquer suposição sua):",
      "",
      ...linhas,
    ].join("\n");

    return { texto, usados };
  } catch {
    // Falha aqui nunca pode impedir a geração.
    return { texto: "", usados: [] };
  }
}
