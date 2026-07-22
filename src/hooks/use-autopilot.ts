import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import * as api from "@/lib/api";
import type {
  AutopilotConfig,
  AutopilotCalendar,
  AutopilotPost,
} from "@/types";
import { requireOrgId } from "@/lib/org";

// ─── Query Keys ─────────────────────────────────────────────────

const keys = {
  configs: ["autopilot", "configs"] as const,
  config: (id: string) => ["autopilot", "config", id] as const,
  calendars: (configId: string) => ["autopilot", "calendars", configId] as const,
  posts: (calendarId: string) => ["autopilot", "posts", calendarId] as const,
};

// ─── Configs ────────────────────────────────────────────────────

export function useAutopilotConfigs() {
  const { user } = useAuth();
  return useQuery({
    queryKey: keys.configs,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("autopilot_configs")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as AutopilotConfig[];
    },
    enabled: !!user,
  });
}

export function useAutopilotConfig(id: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: keys.config(id || ""),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("autopilot_configs")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as unknown as AutopilotConfig;
    },
    enabled: !!user && !!id,
  });
}

export function useSaveAutopilotConfig() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (config: Partial<AutopilotConfig> & { id?: string }) => {
      // themes é jsonb no banco; cast p/ never evita o conflito com o tipo Json gerado.
      const payload = { ...config, user_id: user!.id, org_id: await requireOrgId(), updated_at: new Date().toISOString() } as never;

      if (config.id) {
        const { data, error } = await supabase
          .from("autopilot_configs")
          .update(payload)
          .eq("id", config.id)
          .select()
          .single();
        if (error) throw error;
        return data as unknown as AutopilotConfig;
      } else {
        const { data, error } = await supabase
          .from("autopilot_configs")
          .insert(payload)
          .select()
          .single();
        if (error) throw error;
        return data as unknown as AutopilotConfig;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.configs });
    },
  });
}

export function useToggleAutopilot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const update: Record<string, unknown> = {
        is_active,
        updated_at: new Date().toISOString(),
      };
      // If activating and no next_run, set it to now (trigger on next cron)
      if (is_active) {
        update.next_run_at = new Date().toISOString();
      }
      const { error } = await supabase
        .from("autopilot_configs")
        .update(update)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.configs });
    },
  });
}

// ─── Calendars ──────────────────────────────────────────────────

export function useAutopilotCalendars(configId: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: keys.calendars(configId || ""),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("autopilot_calendars")
        .select("*")
        .eq("config_id", configId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as AutopilotCalendar[];
    },
    enabled: !!user && !!configId,
  });
}

// ─── Posts ───────────────────────────────────────────────────────

export function useAutopilotPosts(calendarId: string | null) {
  return useQuery({
    queryKey: keys.posts(calendarId || ""),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("autopilot_posts")
        .select("*")
        .eq("calendar_id", calendarId!)
        .order("scheduled_at", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as AutopilotPost[];
    },
    enabled: !!calendarId,
  });
}

export function useApproveCalendar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (calendarId: string) => {
      // Approve all draft posts
      const { error: postErr } = await supabase
        .from("autopilot_posts")
        .update({ status: "approved", updated_at: new Date().toISOString() })
        .eq("calendar_id", calendarId)
        .eq("status", "draft");
      if (postErr) throw postErr;

      // Update calendar status
      const { error: calErr } = await supabase
        .from("autopilot_calendars")
        .update({ status: "approved", updated_at: new Date().toISOString() })
        .eq("id", calendarId);
      if (calErr) throw calErr;
    },
    onSuccess: (_, calendarId) => {
      qc.invalidateQueries({ queryKey: keys.posts(calendarId) });
      qc.invalidateQueries({ queryKey: ["autopilot"] });
    },
  });
}

export function useApprovePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (postId: string) => {
      const { error } = await supabase
        .from("autopilot_posts")
        .update({ status: "approved", updated_at: new Date().toISOString() })
        .eq("id", postId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["autopilot", "posts"] });
    },
  });
}

export function useRejectPost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (postId: string) => {
      const { error } = await supabase
        .from("autopilot_posts")
        .delete()
        .eq("id", postId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["autopilot", "posts"] });
    },
  });
}

export function useEditAutopilotPost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      text_content,
      hashtags,
    }: {
      id: string;
      text_content: string;
      hashtags?: string[];
    }) => {
      const update: Record<string, unknown> = {
        text_content,
        updated_at: new Date().toISOString(),
      };
      if (hashtags !== undefined) update.hashtags = hashtags;
      const { error } = await supabase
        .from("autopilot_posts")
        .update(update)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["autopilot", "posts"] });
    },
  });
}

// Regera o visual de um post: limpa mídia/estado e re-agenda o calendário
// (o schedule gera o visual de novo só p/ posts sem mídia e não publicados).
export function useRegeneratePostVisual() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, calendarId }: { id: string; calendarId: string }) => {
      const { error } = await supabase
        .from("autopilot_posts")
        .update({
          media_urls: [], visual_creation_id: null, visual_provider: null,
          status: "approved", error_message: null, updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
      await api.runAutopilot("schedule", { calendar_id: calendarId });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["autopilot"] });
    },
  });
}

// ─── Manual Triggers ────────────────────────────────────────────

export function useRunAutopilot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (configId: string) =>
      api.runAutopilot("generate", { config_id: configId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["autopilot"] });
    },
  });
}

export function useScheduleCalendar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (calendarId: string) =>
      api.runAutopilot("schedule", { calendar_id: calendarId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["autopilot"] });
    },
  });
}

export function useConfirmCalendar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (calendarId: string) =>
      api.runAutopilot("confirm" as "generate", { calendar_id: calendarId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["autopilot"] });
    },
  });
}

export function useCurateCalendar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (calendarId: string) =>
      api.runAutopilot("curate" as "generate", { calendar_id: calendarId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["autopilot"] });
    },
  });
}
