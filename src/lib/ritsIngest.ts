import { getLogger } from "./logger.js";

export type RitsAgentLogPayload = {
  agent_name: string;
  user_message?: string | null;
  agent_reply?: string | null;
  intent?: string | null;
  confidence?: number | null;
  source?: string;
  metadata?: Record<string, unknown>;
};

const MAX_FIELD = 4000;

function clip(s: string | null | undefined, max = MAX_FIELD): string | null {
  if (s == null) return null;
  const t = s.trim();
  if (!t) return null;
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/** 既定 ON。`VERIORA_RITS_GROUP_OBSERVE=false` でグループ傍受のみ停止 */
export function isRitsGroupObserveEnabled(): boolean {
  const v = process.env.VERIORA_RITS_GROUP_OBSERVE?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  return true;
}

/** NEAR → RITS POST /admin/logs（env 未設定時は no-op） */
export async function sendAgentLogToRits(payload: RitsAgentLogPayload): Promise<void> {
  const base = process.env.VERIORA_RITS_BASE_URL?.trim().replace(/\/$/, "");
  const key = process.env.VERIORA_RITS_ADMIN_API_KEY?.trim();
  if (!base || !key || key.length < 12) return;

  const body = {
    agent_name: payload.agent_name,
    user_message: clip(payload.user_message),
    agent_reply: clip(payload.agent_reply),
    intent: payload.intent ?? null,
    confidence: payload.confidence ?? null,
    source: payload.source ?? "line",
    metadata: payload.metadata ?? {},
  };

  try {
    const res = await fetch(`${base}/admin/logs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-api-key": key,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      getLogger().warn(
        { status: res.status, body: text.slice(0, 200) },
        "sendAgentLogToRits failed (non-fatal)"
      );
    }
  } catch (e) {
    getLogger().warn({ err: e }, "sendAgentLogToRits failed (non-fatal)");
  }
}

/** LINE 1往復を RITS に記録（fire-and-forget） */
export function recordLineExchangeToRits(input: {
  userText: string;
  agentReply: string;
  routeTaken?: string;
  groupId?: string | null;
}): void {
  void sendAgentLogToRits({
    agent_name: "NEAR",
    user_message: input.userText,
    agent_reply: input.agentReply,
    intent: input.routeTaken ?? "line",
    source: "line",
    metadata: {
      group_id: input.groupId ?? null,
    },
  }).catch(() => undefined);
}

/** グループ／ルームでボットが返信しなかったテキストも RITS に記録（監査 LLM 対象外） */
export function recordGroupObserveToRits(input: {
  userText: string;
  groupId?: string | null;
  lineSourceType?: string | null;
  actorUserId?: string | null;
  skipReason: string;
}): void {
  if (!isRitsGroupObserveEnabled()) return;
  const text = clip(input.userText);
  if (!text) return;
  void sendAgentLogToRits({
    agent_name: "NEAR",
    user_message: text,
    agent_reply: null,
    intent: "group_observe",
    source: "line",
    metadata: {
      observe_only: true,
      skip_reason: input.skipReason,
      group_id: input.groupId ?? null,
      line_source_type: input.lineSourceType ?? null,
      actor_user_id: input.actorUserId ?? null,
    },
  }).catch(() => undefined);
}
