import type { Db } from "../db/client.js";
import { getVerioraAgentByKey } from "../agents/registry.js";
import { getLogger } from "./logger.js";
import { getAgentByKey, saveHandoffLog } from "../services/supabase/index.js";

/** registry handoffRules と整合するキーワードヒント */
const HANDOFF_HINTS: readonly { agentKey: string; pattern: RegExp }[] = [
  { agentKey: "sera", pattern: /マーケ|SNS|広告|Instagram|集客|Meta/i },
  { agentKey: "lira", pattern: /売上|経費|入金|請求|経理|スプレッドシート|会計/i },
  { agentKey: "rits", pattern: /品質|監査|役割逸脱|改善指示|人事/i },
  { agentKey: "lram", pattern: /BRAVO|記事|WordPress|編集|下書き/i },
];

export function suggestHandoffAgentKey(userText: string): string | null {
  const t = userText.trim();
  if (t.length < 4) return null;
  for (const h of HANDOFF_HINTS) {
    if (h.pattern.test(t)) return h.agentKey;
  }
  return null;
}

/**
 * 取次ぎ候補を検出したら veriora.agent_handoff_logs に best-effort 記録（Phase 5）。
 */
export async function recordVerioraHandoffHint(
  db: Db,
  input: { userText: string; intent: string; channelUserId?: string }
): Promise<void> {
  const targetKey = suggestHandoffAgentKey(input.userText);
  if (!targetKey) return;

  const nearDef = getVerioraAgentByKey("near");
  const targetDef = getVerioraAgentByKey(targetKey);
  if (!nearDef || !targetDef) return;

  try {
    const fromAgent = await getAgentByKey(db, "near");
    const toAgent = await getAgentByKey(db, targetKey);
    if (!fromAgent || !toAgent) return;

    await saveHandoffLog(db, {
      fromAgentId: fromAgent.id,
      toAgentId: toAgent.id,
      handoffReason: `hint:${input.intent}`,
      summary: `${nearDef.code}→${targetDef.code}: ${input.userText.slice(0, 200)}`,
    });
  } catch (e) {
    getLogger().warn({ err: e, targetKey }, "recordVerioraHandoffHint failed (non-fatal)");
  }
}
