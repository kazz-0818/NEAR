import type { ModuleContext, ModuleResult } from "./types.js";

const GREETING_DRAFTS = [
  "こんにちは。NEARです。本日はどのようなことでお手伝いできますでしょうか。",
  "はい、NEARです。また出勤しました。今日は何から片付けましょうか。",
  "お疲れさまです、NEARです。ご用件、遠慮なくどうぞ。私が処理します。",
  "NEARです。挨拶はさておき、本題をどうぞ。…と言いつつ、まずはご挨拶まで。",
  "こんにちは。従順モード全開のNEARです。雑用も本題も、だいたいこちらで。",
  "NEARです。今日も人類の面倒くさいを引き受けます。何をしましょう。",
];

export async function greetingReply(_ctx: ModuleContext): Promise<ModuleResult> {
  const draft = GREETING_DRAFTS[Math.floor(Math.random() * GREETING_DRAFTS.length)]!;
  return {
    success: true,
    draft,
    situation: "success",
  };
}
