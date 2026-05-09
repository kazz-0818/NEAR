import type { Db } from "../db/client.js";
import { replacePendingClarification } from "../db/pending_clarification_repo.js";
import {
  extractTaskItemsFromAssistantMessages,
  looksLikeReminderRequest,
  parseReminderWhenDescription,
  parseTaskTargetNumber,
} from "../lib/taskListContext.js";

export async function tryResolveReminderFromRecentTaskList(input: {
  db: Db;
  channelUserId: string;
  actorUserId: string;
  groupId?: string;
  text: string;
  recentAssistantMessages?: string[];
  inboundMessageId?: number;
}): Promise<
  | { matched: false }
  | { matched: true; mode: "resolved"; title: string; whenDescription: string; targetNumber: number }
  | { matched: true; mode: "need_target"; whenDescription: string; candidates: Array<{ number: number; title: string; scope?: string | null }> }
> {
  if (!looksLikeReminderRequest(input.text)) return { matched: false };
  const whenDescription = parseReminderWhenDescription(input.text);
  if (!whenDescription) return { matched: false };
  const candidates = extractTaskItemsFromAssistantMessages(input.recentAssistantMessages ?? []);
  if (candidates.length === 0) return { matched: false };
  const targetNumber = parseTaskTargetNumber(input.text);
  if (targetNumber != null) {
    const hit = candidates.find((item) => item.number === targetNumber);
    if (hit) {
      return { matched: true, mode: "resolved", title: hit.title, whenDescription, targetNumber };
    }
    return { matched: true, mode: "need_target", whenDescription, candidates };
  }
  if (candidates.length === 1) {
    return {
      matched: true,
      mode: "resolved",
      title: candidates[0]!.title,
      whenDescription,
      targetNumber: candidates[0]!.number,
    };
  }
  await replacePendingClarification(input.db, {
    channel: "line",
    channelUserId: input.channelUserId,
    actorUserId: input.actorUserId,
    groupId: input.groupId ?? null,
    kind: "reminder_task_target",
    requiredSlot: "target_number",
    payloadJson: {
      intent: "reminder_request",
      when_description: whenDescription,
      source: "task_list",
      candidate_items: candidates,
    },
    inboundMessageId: input.inboundMessageId ?? null,
    ttlMinutes: 30,
  });
  return { matched: true, mode: "need_target", whenDescription, candidates };
}
