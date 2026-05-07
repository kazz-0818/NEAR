import type { ModuleContext, ModuleResult } from "./types.js";

function pickTitle(ctx: ModuleContext): string {
  const p = ctx.intent.required_params as Record<string, unknown>;
  const t = p.title;
  if (typeof t === "string" && t.trim()) return t.trim();
  return ctx.originalText.trim().slice(0, 500);
}

/** 「グループタスク」指定かどうかをテキストから判定 */
function isGroupTaskIntent(text: string): boolean {
  return /(グループ|みんな|全員|チーム|共有|共通|グループで|みんなで)/i.test(text.normalize("NFKC"));
}

export async function taskManager(ctx: ModuleContext): Promise<ModuleResult> {
  const title = pickTitle(ctx);
  const notes =
    typeof (ctx.intent.required_params as Record<string, unknown>).notes === "string"
      ? String((ctx.intent.required_params as Record<string, unknown>).notes)
      : null;

  const isGroup = !!ctx.groupId;
  const taskScope = isGroup && isGroupTaskIntent(ctx.originalText) ? "group" : "personal";

  await ctx.db.query(
    `INSERT INTO tasks (channel, channel_user_id, actor_user_id, group_id, task_scope, title, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [ctx.channel, ctx.channelUserId, ctx.actorUserId ?? null, ctx.groupId ?? null, taskScope, title, notes]
  );

  const name = ctx.actorDisplayName ?? null;
  const scopeLabel = taskScope === "group" ? "グループ共有タスク" : "個人タスク";
  const who = name ? `${name}さんの` : "";
  return {
    success: true,
    draft: `承りました。${who}${scopeLabel}として「${title}」を記録しました。`,
    situation: "success",
  };
}
