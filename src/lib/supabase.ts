// Re-export do client + flag de configuração.
// As credenciais vêm exclusivamente do .env (ver src/integrations/supabase/client.ts).
export { supabase, supabaseConfigured } from "@/integrations/supabase/client";
