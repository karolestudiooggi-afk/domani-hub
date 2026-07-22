import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { requireOrgId } from "@/lib/org";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  ScrollText, Loader2, RefreshCw, ImageIcon, FileText, Sparkles,
  Send, Search, CheckCircle2, AlertCircle,
} from "lucide-react";

type LogStep = { titulo: string; detalhe?: string };

type ActivityLog = {
  id: string;
  action: string;
  title: string;
  summary: string | null;
  steps: LogStep[];
  sources: string[] | null;
  status: string;
  created_at: string;
};

/** Ícone e rótulo amigável para cada tipo de ação. */
const ACTION_META: Record<string, { icon: typeof ImageIcon; label: string }> = {
  gerar_imagem: { icon: ImageIcon, label: "Imagem" },
  gerar_texto: { icon: FileText, label: "Texto" },
  assistente: { icon: Sparkles, label: "Assistente" },
  publicar: { icon: Send, label: "Publicação" },
  pesquisar: { icon: Search, label: "Pesquisa" },
};

function meta(action: string) {
  return ACTION_META[action] ?? { icon: ScrollText, label: "Atividade" };
}

/** "há 5 minutos", "ontem às 14:30" — jeito humano de mostrar a data. */
function quando(iso: string): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "agora há pouco";
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

const FILTROS = [
  { id: "todos", label: "Tudo" },
  { id: "gerar_imagem", label: "Imagens" },
  { id: "gerar_texto", label: "Textos" },
  { id: "assistente", label: "Assistente" },
  { id: "publicar", label: "Publicações" },
];

export default function Logs() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState("todos");

  const carregar = async () => {
    setLoading(true);
    setErro(null);
    try {
      const orgId = await requireOrgId();
      const { data, error } = await supabase
        .from("activity_logs")
        .select("*")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      setLogs((data ?? []) as ActivityLog[]);
    } catch (err) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: string }).message)
          : "Não foi possível carregar o histórico.";
      setErro(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void carregar(); }, []);

  const visiveis = filtro === "todos" ? logs : logs.filter((l) => l.action === filtro);

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ScrollText className="h-6 w-6 text-primary" />
            O que o <span className="text-gradient-bilhon">sistema fez</span>
          </h1>
          <p className="mt-1 max-w-2xl text-muted-foreground">
            Cada vez que você pede algo, a IA percorre um caminho: lê a identidade da marca,
            consulta os materiais que você enviou e só então cria. Aqui você acompanha esse
            caminho, passo a passo.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={carregar} disabled={loading}>
          {loading
            ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            : <RefreshCw className="mr-2 h-4 w-4" />}
          Atualizar
        </Button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <Button
            key={f.id}
            variant={filtro === f.id ? "default" : "outline"}
            size="sm"
            className="rounded-full"
            onClick={() => setFiltro(f.id)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {/* Erro */}
      {erro && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-start gap-3 py-4">
            <AlertCircle className="mt-0.5 h-5 w-5 text-destructive" />
            <div>
              <p className="font-medium">Não consegui carregar o histórico</p>
              <p className="text-sm text-muted-foreground">{erro}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Carregando */}
      {loading && !logs.length && (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Vazio */}
      {!loading && !erro && !visiveis.length && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <ScrollText className="mb-4 h-12 w-12 text-muted-foreground/40" />
            <p className="max-w-md text-muted-foreground">
              Nada por aqui ainda. Assim que você gerar uma imagem ou um texto,
              o passo a passo aparece nesta tela.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Lista */}
      {!!visiveis.length && (
        <Accordion type="multiple" className="space-y-3">
          {visiveis.map((log) => {
            const { icon: Icon, label } = meta(log.action);
            const erroLog = log.status === "erro";
            return (
              <AccordionItem
                key={log.id}
                value={log.id}
                className="rounded-lg border bg-card px-4"
              >
                <AccordionTrigger className="py-4 hover:no-underline">
                  <div className="flex flex-1 items-center gap-3 text-left">
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                        erroLog ? "bg-destructive/10" : "bg-primary/10"
                      }`}
                    >
                      <Icon className={`h-4 w-4 ${erroLog ? "text-destructive" : "text-primary"}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{log.title}</span>
                        <Badge variant="outline" className="text-[10px]">{label}</Badge>
                        {erroLog && (
                          <Badge variant="destructive" className="text-[10px]">não concluiu</Badge>
                        )}
                      </div>
                      {log.summary && (
                        <p className="mt-0.5 truncate text-sm text-muted-foreground">
                          {log.summary}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {quando(log.created_at)}
                    </span>
                  </div>
                </AccordionTrigger>

                <AccordionContent className="pb-5">
                  {/* Passos */}
                  {!!log.steps?.length && (
                    <ol className="relative space-y-4 border-l border-border pl-6">
                      {log.steps.map((s, i) => (
                        <li key={i} className="relative">
                          <span className="absolute -left-[27px] flex h-4 w-4 items-center justify-center rounded-full bg-primary/15">
                            <CheckCircle2 className="h-3 w-3 text-primary" />
                          </span>
                          <p className="text-sm font-medium">{s.titulo}</p>
                          {s.detalhe && (
                            <p className="mt-0.5 text-sm text-muted-foreground">{s.detalhe}</p>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}

                  {/* Materiais consultados */}
                  {!!log.sources?.length && (
                    <div className="mt-5 rounded-md bg-muted/50 p-3">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Materiais da marca consultados
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {log.sources.map((s, i) => (
                          <Badge key={i} variant="secondary" className="font-normal">{s}</Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {!log.steps?.length && !log.sources?.length && (
                    <p className="text-sm text-muted-foreground">
                      Sem detalhes adicionais para esta ação.
                    </p>
                  )}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </div>
  );
}
