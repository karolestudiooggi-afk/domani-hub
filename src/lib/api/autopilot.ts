/**
 * Autopilot orchestration via the autopilot-run Edge Function.
 */

import { getSupabaseUrl, baseHeaders } from "./_shared";

export async function runAutopilot(
  action: "generate" | "schedule" | "check_visuals",
  params: { config_id?: string; calendar_id?: string }
): Promise<Record<string, unknown>> {
  const url = `${getSupabaseUrl()}/functions/v1/hub-autopilot-run`;
  const headers = await baseHeaders();

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ action, ...params }),
  });

  if (!response.ok) {
    let errorMsg: string;
    try { const e = await response.json(); errorMsg = e.error || `HTTP ${response.status}`; }
    catch { errorMsg = `HTTP ${response.status}`; }
    throw new Error(errorMsg);
  }

  return response.json();
}
