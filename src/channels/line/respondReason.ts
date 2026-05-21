import {
  isLineGroupOrRoomSource,
  textContainsNearNameReferral,
  textMessageMentionsBot,
} from "./groupMention.js";

export type LineRespondReason = "direct_chat" | "mention" | "name_call" | "growth_capsule";

export function resolveLineRespondReason(params: {
  source?: Record<string, unknown>;
  message?: Record<string, unknown>;
  botUserId?: string;
  text: string;
  isGrowthCapsule?: boolean;
}): LineRespondReason {
  if (params.isGrowthCapsule) return "growth_capsule";
  if (!isLineGroupOrRoomSource(params.source)) return "direct_chat";
  const msg = params.message ?? {};
  const botId = params.botUserId?.trim();
  if (botId && textMessageMentionsBot(msg, botId)) return "mention";
  if (textContainsNearNameReferral(params.text)) return "name_call";
  return "mention";
}

export function shouldAddressCallerByLineName(reason: LineRespondReason | undefined): boolean {
  return reason === "mention" || reason === "name_call";
}
