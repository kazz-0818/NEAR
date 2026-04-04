import type { ModuleContext, ModuleResult } from "./types.js";

const LINES = [
  "タスクの記録（やることリストに追加）",
  "メモの保存",
  "リマインドの受付（お時間の指定がはっきりしていると助かります）",
  "短い文章の要約・整理",
  "簡単な質問へのお答え（一般的な範囲）",
  "NEARができることのご案内（今お送りしている内容です）",
];

export async function helpCapabilities(_ctx: ModuleContext): Promise<ModuleResult> {
  const body = [
    "はい、NEARで現在お手伝いできることは、ざっくり次のとおりです。",
    "",
    ...LINES.map((l) => `・${l}`),
    "",
    "その他のご依頼もお受けしますが、まだ対応できない場合は内容を記録し、できるよう改善してまいります。",
  ].join("\n");
  return { success: true, draft: body, situation: "success" };
}

export function listCapabilityLines(): string[] {
  return [...LINES];
}
