/** Veliora OS 親ブランド名（DB veliora.ai_agents.parent_brand と一致） */
export const VELIORA_PARENT_BRAND = "Veliora OS" as const;

export const VELIORA_AGENT_NEAR = "near" as const;
export const VELIORA_AGENT_SERA = "sera" as const;
export const VELIORA_AGENT_NIA = "nia" as const;
export const VELIORA_AGENT_IRIE = "irie" as const;

/** 会話スレッドキー: 同一 agent + channel + DM またはグループで一意 */
export function buildVelioraConversationKey(
  agentCode: string,
  channel: string,
  lineUserId: string,
  groupId?: string | null
): string {
  const g = groupId?.trim();
  if (g) return `${agentCode}:${channel}:group:${g}`;
  return `${agentCode}:${channel}:dm:${lineUserId.trim()}`;
}
