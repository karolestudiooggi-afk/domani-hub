import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { installSupabaseTracker } from "./lib/dev/supabase-tracker";
// DEV-only: rastreia todas as payloads de/para o Supabase (window.__supabaseTraffic / __dumpTraffic()).
if (import.meta.env.DEV) installSupabaseTracker();
// Fontes do design system (Inter + IBM Plex Mono)
import "./domani-fonts.css";
import "./index.css";
// Tokens de cor e espaçamento do design system
import "./domani-tokens.css";
import "./domani-ds.tokens.css"; // Design system: ponte com o shadcn
import "./domani-bosweb.css";    // Camada de componentes (card-premium, eyebrow, text-h2, gradiente)
import "./domani-effects.css";   // Efeitos visuais (glow, glass, shimmer)
// Bilhon Light Violeta — tema ÚNICO light. Sem alternância dark, sem data-theme legado.
(function () {
  try {
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.add("light");
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-product");
    localStorage.setItem("app_theme", "light");
  } catch (e) {
    document.documentElement.classList.add("light");
  }
})();
import "./domani-effects.js";    // Engine de interação (magnetic, tilt, reveal)

createRoot(document.getElementById("root")!).render(<App />);
