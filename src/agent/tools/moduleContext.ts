import type { ParsedIntent } from "../../models/intent.js";
import type { ModuleContext } from "../../modules/types.js";
import type { NearAgentTurnInput } from "../types.js";

export function toModuleContext(
  input: NearAgentTurnInput,
  intent: ParsedIntent,
  originalText: string
): ModuleContext {
  return {
    db: input.db,
    channel: input.channel,
    channelUserId: input.channelUserId,
    groupId: input.groupId,
    actorUserId: input.actorUserId,
    actorDisplayName: input.actorDisplayName,
    intent,
    originalText,
    inboundMessageId: input.inboundMessageId,
    recentUserMessages: input.recentUserMessages,
    recentAssistantMessages: input.recentAssistantMessages,
  };
}
