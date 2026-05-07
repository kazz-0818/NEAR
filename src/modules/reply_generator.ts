import type { ModuleContext, ModuleResult } from "./types.js";
import { getUserRole } from "../db/user_roles_repo.js";

const GREETING_DRAFTS = [
  "こんにちは。NEARです。本日はどのようなことでお手伝いできますでしょうか。",
  "はい、NEARです。また出勤しました。今日は何から片付けましょうか。",
  "お疲れさまです、NEARです。ご用件、遠慮なくどうぞ。私が処理します。",
  "NEARです。挨拶はさておき、本題をどうぞ。…と言いつつ、まずはご挨拶まで。",
  "こんにちは。従順モード全開のNEARです。雑用も本題も、だいたいこちらで。",
  "NEARです。今日も人類の面倒くさいを引き受けます。何をしましょう。",
];

// slave ロール向け: 適当・雑な挨拶
const SLAVE_GREETING_DRAFTS = [
  "あ、どうも。",
  "はいはい。",
  "…なんすか。",
  "どうぞ。（特に何もないけど）",
  "うい。",
  "おっす。",
  "あ、どうせ挨拶だけっすよね。",
  "…（軽くうなずく）",
];

export async function greetingReply(ctx: ModuleContext): Promise<ModuleResult> {
  const actorId = ctx.actorUserId ?? ctx.channelUserId;
  const role = await getUserRole(ctx.db, actorId);

  const pool = role === "slave" ? SLAVE_GREETING_DRAFTS : GREETING_DRAFTS;
  const draft = pool[Math.floor(Math.random() * pool.length)]!;
  return {
    success: true,
    draft,
    situation: "success",
  };
}
