import type { ModuleContext, ModuleResult } from "./types.js";

function pickBody(ctx: ModuleContext): string {
  const p = ctx.intent.required_params as Record<string, unknown>;
  const b = p.body;
  if (typeof b === "string" && b.trim()) return b.trim();
  return ctx.originalText.trim().slice(0, 2000);
}

export async function memoStore(ctx: ModuleContext): Promise<ModuleResult> {
  const body = pickBody(ctx);
  await ctx.db.query(`INSERT INTO memos (channel, channel_user_id, body) VALUES ($1, $2, $3)`, [
    ctx.channel,
    ctx.channelUserId,
    body,
  ]);
  return {
    success: true,
    draft: "メモに保存しました。必要になった際にお呼びください。",
    situation: "success",
  };
}
