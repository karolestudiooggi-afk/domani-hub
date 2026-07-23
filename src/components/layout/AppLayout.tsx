import { Suspense } from "react";
import { Outlet } from "react-router-dom";
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

export function AppLayout() {
  const { configLoading } = useApp();

  if (configLoading) return null;

  // Sem pedágio de setup: quem chegou aqui está logado e navega livremente.
  // Configurações pendentes (Post for Me, etc.) são sinalizadas dentro das
  // telas, não bloqueando o acesso ao app.
  return (
    <div className="min-h-screen bg-background">
      <AppSidebar />
      <main className="min-h-[calc(100vh-4rem)]">
        <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
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
