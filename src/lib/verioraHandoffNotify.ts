import { getEnv } from "../config/env.js";
import { getLogger } from "./logger.js";

/** Phase 7: NEAR → LRAM 内部取次ぎ HTTP（設定時のみ） */
export async function notifyLramHandoff(input: {
  userText: string;
  intent: string;
  channelUserId?: string;
  summary?: string;
}): Promise<void> {
  const env = getEnv();
  const base = env.NEAR_LRAM_BASE_URL?.trim().replace(/\/$/, "");
  const secret = env.VERIORA_HANDOFF_SECRET?.trim();
  if (!base || !secret || secret.length < 12) return;

  const url = `${base}/internal/handoff/near`;
  const log = getLogger();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_text: input.userText,
        channel_user_id: input.channelUserId ?? null,
        intent: input.intent,
        summary: input.summary ?? null,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.warn({ status: res.status, body: body.slice(0, 300), url }, "notifyLramHandoff non-2xx");
    }
  } catch (e) {
    log.warn({ err: e, url }, "notifyLramHandoff failed (non-fatal)");
  }
}
