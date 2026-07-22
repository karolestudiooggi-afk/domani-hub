/**
 * REGISTRO DE ATIVIDADE
 *
 * Grava, em linguagem simples, o que o sistema fez — para o cliente
 * acompanhar na aba "Logs" sem precisar entender nada técnico.
 *
 * A ideia é contar a história: o que foi pedido, de que material da marca
 * a IA se alimentou, o que ela produziu.
 */
import { supabase } from "@/integrations/supabase/client";
import { requireOrgId } from "@/lib/org";

export type LogStep = {
  titulo: string;
  detalhe?: string;
};

export type LogEntry = {
  /** gerar_imagem | gerar_texto | assistente | publicar | pesquisar */
  action: string;
  /** Título curto e claro: "Imagem criada", "Legenda gerada" */
  title: string;
  /** Resumo em uma frase, do jeito que uma pessoa contaria */
  summary?: string;
  /** Passos do que aconteceu, na ordem */
  steps?: LogStep[];
  /** Quais materiais da marca foram usados como referência */
  sources?: string[];
  status?: "sucesso" | "erro";
};

/**
 * Registra uma atividade. Nunca lança erro — se o log falhar, a ação
 * principal do usuário não pode quebrar por causa disso.
 */
export async function logActivity(entry: LogEntry): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const org_id = await requireOrgId();

    await supabase.from("activity_logs").insert({
      org_id,
      user_id: user.id,
      action: entry.action,
      title: entry.title,
      summary: entry.summary ?? null,
      steps: entry.steps ?? [],
      sources: entry.sources ?? [],
      status: entry.status ?? "sucesso",
    });
  } catch (err) {
    // Silencioso de propósito: log é acessório, não pode atrapalhar o uso.
    console.debug("[activity-log] não foi possível registrar:", err);
  }
}

/**
 * Monta os passos padrão de uma geração de conteúdo pela IA.
 * Centralizado aqui para o texto ficar consistente em todo o app.
 */
export function passosDeGeracao(opts: {
  pedido: string;
  marca?: string;
  materiais?: string[];
  tipo: "imagem" | "texto";
}): LogStep[] {
  const { pedido, marca, materiais = [], tipo } = opts;
  const passos: LogStep[] = [
    {
      titulo: "Recebemos seu pedido",
      detalhe: `Você pediu: "${pedido.slice(0, 220)}${pedido.length > 220 ? "…" : ""}"`,
    },
    {
      titulo: "A IA carregou a identidade da marca",
      detalhe: marca
        ? `Usou o perfil de ${marca}: tom de voz, cores, palavras a evitar e as regras da marca.`
        : "Usou o perfil da marca cadastrado: tom de voz, cores, palavras a evitar e as regras da marca.",
    },
  ];

  if (materiais.length) {
    passos.push({
      titulo: "Consultou os materiais que você enviou",
      detalhe: `Levou em conta: ${materiais.join(", ")}.`,
    });
  }

  passos.push({
    titulo: tipo === "imagem" ? "Criou a imagem" : "Escreveu o conteúdo",
    detalhe:
      tipo === "imagem"
        ? "Aplicou a direção visual da marca — luz quente, superfícies escuras e elementos do universo da marca."
        : "Escreveu no tom da marca, evitando as palavras proibidas e usando os fatos reais cadastrados.",
  });

  return passos;
}
