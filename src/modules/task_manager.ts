import type { ModuleContext, ModuleResult } from "./types.js";

function pickTitle(ctx: ModuleContext): string {
  const p = ctx.intent.required_params as Record<string, unknown>;
  const t = p.title;
  if (typeof t === "string" && t.trim()) return t.trim();
  return ctx.originalText.trim().slice(0, 500);
}

/** グループ内で「個人タスクとして」と明示しているか（それ以外はグループ共有がデフォルト） */
function isExplicitPersonalTaskIntent(text: string): boolean {
  const n = text.normalize("NFKC");
  return (
    /個人(?:タスク|のタスク|だけ|用|向け|的に)/i.test(n) ||
    /自分(?:だけ|のみ|用|のタスク)/i.test(n) ||
    /(?:俺|僕|私)(?:だけ|のみ|用)/i.test(n) ||
    /プライベート|private/i.test(n)
  );
}

export async function taskManager(ctx: ModuleContext): Promise<ModuleResult> {
  const title = pickTitle(ctx);
  const notes =
    typeof (ctx.intent.required_params as Record<string, unknown>).notes === "string"
      ? String((ctx.intent.required_params as Record<string, unknown>).notes)
      : null;

  const isGroup = !!ctx.groupId;
  // グループではデフォルトでグループ共有タスク、個人と明示した場合のみ個人タスク
  const taskScope = !isGroup ? "personal" : isExplicitPersonalTaskIntent(ctx.originalText) ? "personal" : "group";

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
