import { useState, useMemo } from "react";
import {
  Bot, Play, Pause, RefreshCw, Settings2, Plus, Loader2,
  CheckCheck, Send, AlertCircle, History, Activity, Lightbulb,
  Sparkles, ThumbsUp, CalendarClock,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AutopilotWizard } from "@/components/autopilot/AutopilotWizard";
import { AutopilotPostCard } from "@/components/autopilot/AutopilotPostCard";
import { CalendarStatusBadge } from "@/components/autopilot/AutopilotStatusBadge";
import {
  useAutopilotConfigs, useAutopilotCalendars, useAutopilotPosts,
  useToggleAutopilot, useRunAutopilot, useApproveCalendar,
  useScheduleCalendar, useCurateCalendar,
} from "@/hooks/use-autopilot";
import { useApp } from "@/contexts/AppContext";
import type { AutopilotConfig, AutopilotPost, AutopilotPostStatus } from "@/types";
import { toast } from "sonner";
import { Link } from "react-router-dom";

type ColumnKey = "ideas" | "generated" | "approved" | "scheduled";

const COLUMNS: {
  key: ColumnKey;
  title: string;
  subtitle: string;
  icon: typeof Lightbulb;
  accent: string;
  statuses: AutopilotPostStatus[];
}[] = [
  { key: "ideas",     title: "Ideias",    subtitle: "Rascunhos gerados pela IA", icon: Lightbulb,     accent: "from-amber-400/60 to-amber-500/60",   statuses: ["draft"] },
  { key: "generated", title: "Geradas",   subtitle: "Visual em produção",         icon: Sparkles,      accent: "from-orange-400/60 to-amber-500/60", statuses: ["generating_visual", "visual_ready"] },
  { key: "approved",  title: "Aprovadas", subtitle: "Prontas para agendar",       icon: ThumbsUp,      accent: "from-emerald-400/60 to-emerald-500/60", statuses: ["approved"] },
  { key: "scheduled", title: "Agendadas", subtitle: "Fila de publicação",         icon: CalendarClock, accent: "from-sky-400/60 to-indigo-500/60",     statuses: ["scheduled", "published"] },
];

export default function Autopilot() {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<AutopilotConfig | null>(null);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [selectedCalendarId, setSelectedCalendarId] = useState<string | null>(null);

  const { config: appConfig } = useApp();
  const configsQuery = useAutopilotConfigs();
  const calendarsQuery = useAutopilotCalendars(selectedConfigId);

  const toggleAutopilot = useToggleAutopilot();
  const runAutopilot = useRunAutopilot();
  const approveCalendar = useApproveCalendar();
  const scheduleCalendar = useScheduleCalendar();
  const curateCalendar = useCurateCalendar();

  const configs = configsQuery.data || [];
  const calendars = calendarsQuery.data || [];
  const activeConfig = configs.find((c) => c.id === selectedConfigId) || configs[0] || null;
  const latestCalendar = calendars[0] || null;
  const activeCalendarId = selectedCalendarId || latestCalendar?.id || null;
  const postsQuery = useAutopilotPosts(activeCalendarId);
  const posts = postsQuery.data || [];

  // Auto-select first config
  if (!selectedConfigId && configs.length > 0 && !wizardOpen) {
    setSelectedConfigId(configs[0].id);
  }

  const grouped = useMemo(() => {
    const map: Record<ColumnKey, AutopilotPost[]> = {
      ideas: [], generated: [], approved: [], scheduled: [],
    };
    for (const p of posts) {
      const col = COLUMNS.find((c) => c.statuses.includes(p.status as AutopilotPostStatus));
      if (col) map[col.key].push(p);
    }
    return map;
  }, [posts]);

  function openNewWizard() { setEditingConfig(null); setWizardOpen(true); }
  function openEditWizard() { if (activeConfig) { setEditingConfig(activeConfig); setWizardOpen(true); } }
  function handleConfigSaved(cfg: AutopilotConfig) {
    setWizardOpen(false); setEditingConfig(null); setSelectedConfigId(cfg.id);
  }

  function handleToggle() {
    if (!activeConfig) return;
    toggleAutopilot.mutate(
      { id: activeConfig.id, is_active: !activeConfig.is_active },
      { onSuccess: () => toast.success(activeConfig.is_active ? "Autopilot pausado" : "Autopilot ativado!") }
    );
  }
  function handleGenerate() {
    if (!activeConfig) return;
    runAutopilot.mutate(activeConfig.id, {
      onSuccess: () => { toast.success("Ciclo gerado!"); calendarsQuery.refetch(); },
      onError: (err) => toast.error(`Erro: ${err.message}`),
    });
  }
  function handleApproveAll() {
    if (!activeCalendarId) return;
    approveCalendar.mutate(activeCalendarId, {
      onSuccess: () => toast.success("Todos os posts aprovados!"),
      onError: (err) => toast.error(`Erro: ${err.message}`),
    });
  }
  function handleScheduleAll() {
    if (!activeCalendarId) return;
    scheduleCalendar.mutate(activeCalendarId, {
      onSuccess: () => toast.success("Posts agendados!"),
      onError: (err) => toast.error(`Erro: ${err.message}`),
    });
  }
  function handleCurate() {
    if (!activeCalendarId) return;
    curateCalendar.mutate(activeCalendarId, {
      onSuccess: () => toast.success("Curadoria IA concluída!"),
      onError: (err) => toast.error(`Erro: ${err.message}`),
    });
  }

  // ── Loading ─────────────────────────────────────────
  if (configsQuery.isLoading) {
    return (
      <div className="space-y-4 p-1">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-64 w-full" />)}
        </div>
      </div>
    );
  }

  // ── Empty state ─────────────────────────────────────
  if (configs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-amber-600 text-primary-foreground shadow-xl shadow-orange-500/25">
          <Bot className="h-10 w-10" />
        </div>
        <div className="text-center space-y-2">
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
            <span className="text-gradient-domani">Autopilot</span>
          </h1>
          <p className="text-muted-foreground max-w-md">
            Pesquisa, cria, gera visuais e agenda publicações recorrentes — no automático.
          </p>
        </div>
        <Button size="lg" className="bg-gradient-to-r from-orange-500 to-amber-600 gap-2" onClick={openNewWizard}>
          <Plus className="h-5 w-5" /> Configurar Autopilot
        </Button>
        <WizardSheet open={wizardOpen} onOpenChange={setWizardOpen} editingConfig={editingConfig} onSaved={handleConfigSaved} />
      </div>
    );
  }

  const missing: string[] = [];
  if (!appConfig.postformeApiKey) missing.push("Post for Me");
  if (!appConfig.firecrawlApiKey && activeConfig?.research_topics?.length) missing.push("Firecrawl");

  return (
    <div className="space-y-5 p-1">
      {/* ── Header ────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-amber-600 text-primary-foreground shadow-lg shadow-orange-500/20">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
              <span className="text-gradient-domani">Autopilot</span>
            </h1>
            <p className="text-sm text-muted-foreground">Esteira de conteúdo automatizado</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <History className="h-4 w-4 mr-1" /> Histórico
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 max-h-96 overflow-auto">
              {calendars.length === 0 && (
                <div className="p-3 text-xs text-muted-foreground">Nenhum ciclo ainda.</div>
              )}
              {calendars.map((cal) => (
                <DropdownMenuItem
                  key={cal.id}
                  onClick={() => setSelectedCalendarId(cal.id)}
                  className={activeCalendarId === cal.id ? "bg-accent" : ""}
                >
                  <div className="flex items-center justify-between gap-2 w-full">
                    <div className="text-sm">
                      <div className="font-medium">{cal.cycle_start} — {cal.cycle_end}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {cal.research_results?.length || 0} fontes
                      </div>
                    </div>
                    <CalendarStatusBadge status={cal.status} />
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {activeConfig && (
            <div className="hidden md:flex items-center gap-1.5 text-xs text-muted-foreground">
              <Activity className="h-3.5 w-3.5" />
              {activeConfig.last_run_at
                ? <>Última: {new Date(activeConfig.last_run_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}</>
                : <>Nunca executado</>}
            </div>
          )}

          <Button variant="outline" size="sm" onClick={openNewWizard}>
            <Plus className="h-4 w-4 mr-1" /> Nova config
          </Button>
        </div>
      </div>

      {/* ── Alertas ────────────────────────────────────── */}
      {missing.length > 0 && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardContent className="p-3 flex items-start gap-3">
            <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <div className="text-sm">
              <span className="font-medium text-amber-700 dark:text-amber-400">
                API keys pendentes: {missing.join(", ")}.
              </span>{" "}
              <Link to="/setup?manage=1" className="text-primary hover:underline">Configurar</Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Barra de estado ─────────────────────────────── */}
      {activeConfig && (
        <Card className="card-premium">
          <CardContent className="p-3 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <Badge
                variant={activeConfig.is_active ? "default" : "secondary"}
                className={activeConfig.is_active ? "bg-green-600" : ""}
              >
                {activeConfig.is_active ? "Ativo" : "Pausado"}
              </Badge>
              <span className="text-sm font-medium">
                {activeConfig.platforms.length} plataformas · {activeConfig.posts_per_cycle} posts/
                {activeConfig.recurrence === "weekly" ? "semana" : activeConfig.recurrence === "biweekly" ? "quinzena" : "mês"}
              </span>
              {activeConfig.next_run_at && activeConfig.is_active && (
                <span className="text-xs text-muted-foreground">
                  Próximo ciclo:{" "}
                  {new Date(activeConfig.next_run_at).toLocaleDateString("pt-BR", {
                    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                  })}
                </span>
              )}
              {latestCalendar && (
                <span className="hidden md:inline-flex items-center gap-1 text-xs text-muted-foreground">
                  · Ciclo atual <CalendarStatusBadge status={latestCalendar.status} />
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleToggle} disabled={toggleAutopilot.isPending}>
                {activeConfig.is_active
                  ? <><Pause className="h-3.5 w-3.5 mr-1" /> Pausar</>
                  : <><Play className="h-3.5 w-3.5 mr-1" /> Ativar</>}
              </Button>
              <Button
                size="sm"
                className="bg-gradient-to-r from-orange-500 to-amber-600"
                onClick={handleGenerate}
                disabled={runAutopilot.isPending || !appConfig.postformeApiKey}
              >
                {runAutopilot.isPending
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                Gerar ciclo
              </Button>
              <Button size="sm" variant="ghost" onClick={openEditWizard} title="Configurar">
                <Settings2 className="h-3.5 w-3.5 mr-1" /> Configurar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Ações do ciclo (bulk) ──────────────────────── */}
      {latestCalendar && (grouped.ideas.length > 0 || grouped.approved.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {grouped.ideas.length > 0 && (
            <>
              <Button size="sm" onClick={handleApproveAll} disabled={approveCalendar.isPending} className="gap-1">
                <CheckCheck className="h-3.5 w-3.5" /> Aprovar tudo ({grouped.ideas.length})
              </Button>
              <Button size="sm" variant="outline" onClick={handleCurate} disabled={curateCalendar.isPending} className="gap-1">
                {curateCalendar.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
                Curar com IA
              </Button>
            </>
          )}
          {grouped.approved.length > 0 && (
            <Button
              size="sm"
              onClick={handleScheduleAll}
              disabled={scheduleCalendar.isPending}
              className="gap-1 bg-gradient-to-r from-orange-500 to-amber-600"
            >
              {scheduleCalendar.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Agendar tudo ({grouped.approved.length})
            </Button>
          )}
        </div>
      )}

      {/* ── KANBAN ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {COLUMNS.map((col) => {
          const items = grouped[col.key];
          const Icon = col.icon;
          return (
            <div
              key={col.key}
              className="flex flex-col rounded-2xl border border-border bg-card/60 backdrop-blur-sm min-h-[300px]"
            >
              <div className="p-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br ${col.accent} text-primary-foreground shadow-sm`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm">{col.title}</h3>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                        {items.length}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{col.subtitle}</p>
                  </div>
                </div>
              </div>

              <div className="flex-1 p-3 space-y-3 overflow-auto max-h-[calc(100vh-320px)]">
                {postsQuery.isLoading ? (
                  <>
                    <Skeleton className="h-40 w-full" />
                    <Skeleton className="h-40 w-full" />
                  </>
                ) : items.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center gap-1">
                    <Icon className="h-6 w-6 text-muted-foreground/40" />
                    <p className="text-xs text-muted-foreground">Sem posts nesta etapa</p>
                  </div>
                ) : (
                  items.map((post) => (
                    <div key={post.id} className="relative">
                      {col.key === "scheduled" && post.status === "published" && (
                        <Badge className="absolute top-2 right-2 z-10 bg-green-600 text-[10px] px-1.5 py-0 h-5">
                          Publicado
                        </Badge>
                      )}
                      <AutopilotPostCard post={post} />
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!latestCalendar && (
        <div className="text-center py-10">
          <p className="text-sm text-muted-foreground mb-3">
            Nenhum ciclo gerado ainda. Clique em <b>Gerar ciclo</b> para começar.
          </p>
        </div>
      )}

      <WizardSheet open={wizardOpen} onOpenChange={setWizardOpen} editingConfig={editingConfig} onSaved={handleConfigSaved} />
    </div>
  );
}

// ── Sheet lateral com o Wizard ─────────────────────────
function WizardSheet({
  open, onOpenChange, editingConfig, onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editingConfig: AutopilotConfig | null;
  onSaved: (cfg: AutopilotConfig) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            {editingConfig ? "Editar Autopilot" : "Configurar Autopilot"}
          </SheetTitle>
          <SheetDescription>
            Marca, temas, plataformas, visual, recorrência e aprovação — em 7 etapas.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          <AutopilotWizard
            existingConfig={editingConfig}
            onSaved={onSaved}
            onCancel={() => onOpenChange(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
