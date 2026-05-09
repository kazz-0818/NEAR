import type { Db } from "../db/client.js";
import { getPendingClarification, markPendingClarificationStatus } from "../db/pending_clarification_repo.js";
import { parseTaskTargetNumber } from "../lib/taskListContext.js";

export async function tryHandlePendingClarification(input: {
  db: Db;
  channel: string;
  channelUserId: string;
  actorUserId?: string;
  groupId?: string;
  text: string;
}, deps?: {
  getPending?: typeof getPendingClarification;
  markStatus?: typeof markPendingClarificationStatus;
}): Promise<
  | { handled: false }
  | { handled: true; finalText: string }
  | { handled: false; forceIntent: "reminder_request"; forceRequiredParams: Record<string, unknown> }
> {
  const getPending = deps?.getPending ?? getPendingClarification;
  const markStatus = deps?.markStatus ?? markPendingClarificationStatus;
  const pending = await getPending(input.db, {
    channel: input.channel,
    channelUserId: input.channelUserId,
    actorUserId: input.actorUserId ?? null,
    groupId: input.groupId ?? null,
  });
  if (!pending) return { handled: false };
  if (pending.kind !== "reminder_task_target") return { handled: false };
  const candidates = Array.isArray(pending.payload_json.candidate_items)
    ? (pending.payload_json.candidate_items as Array<Record<string, unknown>>)
    : [];
  const whenDescription =
    typeof pending.payload_json.when_description === "string"
      ? pending.payload_json.when_description
      : null;
  if (!whenDescription) {
    await markStatus(input.db, pending.id, "cancelled");
    return { handled: true, finalText: "確認情報の期限が切れました。もう一度、リマインドしたい内容を教えてください。" };
  }
  const targetNumber = parseTaskTargetNumber(input.text);
  if (targetNumber == null) {
    return { handled: true, finalText: "番号で教えてください。例: 「1ばん」" };
  }
  const hit = candidates.find((item) => Number(item.number) === targetNumber);
  if (!hit) {
    return { handled: true, finalText: "その番号は見つかりませんでした。タスク一覧の番号で指定してください。" };
  }
  const title = typeof hit.title === "string" ? hit.title.trim() : "";
  if (!title) {
    return { handled: true, finalText: "対象タスクを特定できませんでした。もう一度タスク一覧を表示して試してください。" };
  }
  await markStatus(input.db, pending.id, "consumed");
  return {
    handled: false,
    forceIntent: "reminder_request",
    forceRequiredParams: {
      message: title,
      when_description: whenDescription,
      target_number: targetNumber,
      target_label: title,
      pending_clarification_id: pending.id,
    },
  };
}
