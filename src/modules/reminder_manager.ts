import {
  isReminderTimeInPast,
  parseRelativeReminderAt,
} from "../lib/datetimeContext.js";
import type { ModuleContext, ModuleResult } from "./types.js";

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

  const relative = parseRelativeReminderAt(ctx.originalText, now);
  let iso = relative ?? parseIso(p.datetime_iso);
  let pastTimeDetected = false;
  if (iso && !relative && isReminderTimeInPast(iso, now)) {
    pastTimeDetected = true;
    iso = null;
  }

  if (iso) {
    await ctx.db.query(
      `INSERT INTO reminders (channel, channel_user_id, remind_at, message, status) VALUES ($1, $2, $3, $4, 'pending')`,
      [ctx.channel, ctx.channelUserId, iso.toISOString(), message]
    );

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
