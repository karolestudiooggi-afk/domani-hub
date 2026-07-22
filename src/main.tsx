import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { installSupabaseTracker } from "./lib/dev/supabase-tracker";
// DEV-only: rastreia todas as payloads de/para o Supabase (window.__supabaseTraffic / __dumpTraffic()).
if (import.meta.env.DEV) installSupabaseTracker();
// @bilhon/ds fonts (Inter + IBM Plex Mono) — remover esta linha reverte
import "./bilhon-fonts.css";
import "./index.css";
// @bilhon/ds tokens --bl-* (define o namespace p/ bos-web/effects/motion) — remover reverte
import "./bilhon-tokens.css";
import "./bilhon-ds.tokens.css"; // @bilhon/ds re-skin (shadcn bridge, !important) — remover esta linha reverte
import "./bilhon-bosweb.css";    // @bilhon/ds bos-web layer (card-premium/eyebrow/text-h2/gradiente) — reversível
import "./bilhon-effects.css";   // @bilhon/ds effects (glow/glass/shimmer) — reversível
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
import "./bilhon-effects.js";    // engine (magnetic/tilt/reveal) — reversível

createRoot(document.getElementById("root")!).render(<App />);
