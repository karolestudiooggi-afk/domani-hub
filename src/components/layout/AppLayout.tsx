import { Suspense } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { AppSidebar } from "./AppSidebar";
import { useApp } from "@/contexts/AppContext";

function PageFallback() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

/**
 * Telas que ocupam a largura inteira: são ferramentas com painéis laterais
 * ou colunas, e ficam apertadas dentro de um container estreito.
 * As demais mantêm a largura de leitura confortável.
 */
const TELAS_LARGAS = ["/studio", "/autopilot", "/schedule"];

export function AppLayout() {
  const { configLoading } = useApp();
  const { pathname } = useLocation();
  const telaLarga = TELAS_LARGAS.some((r) => pathname.startsWith(r));

  if (configLoading) return null;

  // Sem pedágio de setup: quem chegou aqui está logado e navega livremente.
  // Configurações pendentes (Post for Me, etc.) são sinalizadas dentro das
  // telas, não bloqueando o acesso ao app.
  return (
    <div className="min-h-screen bg-background">
      <AppSidebar />
      <main className="min-h-[calc(100vh-4rem)]">
        <div className={`mx-auto w-full p-4 sm:p-6 lg:p-8 ${telaLarga ? "max-w-none" : "max-w-7xl"}`}>
          {/* Suspense do CONTEÚDO fica aqui dentro (e não em volta de <Routes>) para
              que o carregamento lazy de cada página NÃO desmonte os menus/layout —
              era isso que dava a sensação de "refresh completo" a cada navegação. */}
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
