import type { Db } from "../db/client.js";
import { replacePendingClarification } from "../db/pending_clarification_repo.js";
import type { TaskListItem } from "../lib/taskListContext.js";
import {
  extractTaskItemsFromAssistantMessages,
  looksLikeReminderRequest,
  parseReminderWhenDescription,
  parseTaskTargetNumber,
} from "../lib/taskListContext.js";

function mergeTaskCandidatesFromSession(
  fromMessages: TaskListItem[],
  sessionList: TaskListItem[] | null | undefined
): TaskListItem[] {
  const session = sessionList ?? [];
  if (session.length === 0) return fromMessages;
  const byNum = new Map<number, TaskListItem>();
  for (const s of session) byNum.set(s.number, s);
  for (const m of fromMessages) {
    if (!byNum.has(m.number)) byNum.set(m.number, m);
  }
  return [...byNum.values()].sort((a, b) => a.number - b.number);
}

export async function tryResolveReminderFromRecentTaskList(input: {
  db: Db;
  channelUserId: string;
  actorUserId: string;
  groupId?: string;
  text: string;
  recentAssistantMessages?: string[];
  quotedAssistantMessage?: string;
  inboundMessageId?: number;
  /** タスク一覧メモリ（直近表示の番号付きタスク） */
  sessionTaskList?: TaskListItem[] | null;
  /** 直近タスク作成（「これ」＋リマインド用） */
  sessionLatestTaskTitle?: string | null;
}): Promise<
  | { matched: false }
  | { matched: true; mode: "resolved"; title: string; whenDescription: string; targetNumber: number }
  | { matched: true; mode: "need_target"; whenDescription: string; candidates: Array<{ number: number; title: string; scope?: string | null }> }
> {
  if (!looksLikeReminderRequest(input.text)) return { matched: false };
  const whenDescription = parseReminderWhenDescription(input.text);
  if (!whenDescription) return { matched: false };
  const contextMessages = input.quotedAssistantMessage
    ? [...(input.recentAssistantMessages ?? []), input.quotedAssistantMessage]
    : (input.recentAssistantMessages ?? []);
  let candidates = extractTaskItemsFromAssistantMessages(contextMessages);
  candidates = mergeTaskCandidatesFromSession(candidates, input.sessionTaskList ?? null);
  const deicticLatest =
    /^(これ|それ|あれ|さっきの|直前の|上の)/u.test(input.text.normalize("NFKC").trim()) &&
    input.sessionLatestTaskTitle &&
    input.sessionLatestTaskTitle.trim().length > 0;
  if (candidates.length === 0 && deicticLatest && input.sessionLatestTaskTitle) {
    candidates = [{ number: 1, title: input.sessionLatestTaskTitle.trim(), scope: null }];
  }
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
