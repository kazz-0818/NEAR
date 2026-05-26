import {
  isReminderTimeInPast,
  parseRelativeReminderAt,
  parseReminderAtFromDescription,
} from "../lib/datetimeContext.js";
import type { ModuleContext, ModuleResult } from "./types.js";
import { upsertSessionMemory } from "../services/conversation_session_memory.js";

function parseIso(s: unknown): Date | null {
  if (typeof s !== "string" || !s.trim()) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function reminderManager(ctx: ModuleContext): Promise<ModuleResult> {
  const now = new Date();
  const p = ctx.intent.required_params as Record<string, unknown>;
  const message =
    typeof p.message === "string" && p.message.trim()
      ? p.message.trim()
      : ctx.originalText.trim().slice(0, 500);
  const whenDescription =
    typeof p.when_description === "string" && p.when_description.trim()
      ? p.when_description.trim()
      : null;

  const whenText = whenDescription ?? ctx.originalText;
  const relative = parseRelativeReminderAt(whenText, now);
  let iso =
    relative ??
    (whenDescription ? parseReminderAtFromDescription(whenDescription, now) : null) ??
    parseIso(p.datetime_iso);
  const taskIdRaw = p.task_id;
  const taskId =
    typeof taskIdRaw === "string" && taskIdRaw.trim() ? taskIdRaw.trim() : null;
  let pastTimeDetected = false;
  if (iso && !relative && isReminderTimeInPast(iso, now)) {
    pastTimeDetected = true;
    iso = null;
  }

  if (iso) {
    const ins = await ctx.db.query<{ id: number }>(
      `INSERT INTO near_reminders (channel, channel_user_id, actor_user_id, group_id, remind_at, message, status, task_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7::bigint)
       RETURNING id`,
      [
        ctx.channel,
        ctx.channelUserId,
        ctx.actorUserId ?? null,
        ctx.groupId ?? null,
        iso.toISOString(),
        message,
        taskId,
      ]
    );
    const rid = ins.rows[0]?.id;
    if (rid != null) {
      void upsertSessionMemory(ctx.db, {
        channelUserId: ctx.channelUserId,
        memoryType: "latest_reminder_created",
        value: { id: rid, message, remind_at: iso.toISOString() },
        sourceMessageId: ctx.inboundMessageId,
        sourceRoute: "reminder_manager",
        expiresAt: new Date(Date.now() + 120 * 60 * 1000),
      });
    }

    const when = iso.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
    return {
      success: true,
      draft: `リマインドを受け付けました。${when} 頃に「${message}」についてお知らせいたします。`,
      situation: "success",
    };
  }

  if (pastTimeDetected) {
    return {
      success: true,
      draft:
        "指定された時刻はすでに過ぎています。改めて日付とお時間をお知らせいただけますか？（例: 「明日の10時」「30分後」）",
      situation: "followup",
    };
  }

  if (ctx.intent.needs_followup && ctx.intent.followup_question) {
    return {
      success: true,
      draft: ctx.intent.followup_question,
      situation: "followup",
    };
  }

  return {
    success: true,
    draft:
      "リマインドの日付とお時間を教えてください。「4月5日10時」「30分後」のように送ってもらえると設定します。",
    situation: "followup",
  };
}
