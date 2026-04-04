import type { ModuleContext, ModuleResult } from "./types.js";

function pickTitle(ctx: ModuleContext): string {
  const p = ctx.intent.required_params as Record<string, unknown>;
  const t = p.title;
  if (typeof t === "string" && t.trim()) return t.trim();
  return ctx.originalText.trim().slice(0, 500);
}

export async function taskManager(ctx: ModuleContext): Promise<ModuleResult> {
  const title = pickTitle(ctx);
  const notes =
    typeof (ctx.intent.required_params as Record<string, unknown>).notes === "string"
      ? String((ctx.intent.required_params as Record<string, unknown>).notes)
      : null;

  await ctx.db.query(
    `INSERT INTO tasks (channel, channel_user_id, title, notes) VALUES ($1, $2, $3, $4)`,
    [ctx.channel, ctx.channelUserId, title, notes]
  );

  return {
    success: true,
    draft: `タスクとして承りました。「${title}」を記録済みです。`,
    situation: "success",
  };
}
