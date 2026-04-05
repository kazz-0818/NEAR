import type { Db } from "../db/client.js";
import type { ModuleContext, ModuleResult } from "./types.js";

/** DB 未投入時のフォールバック（capability_registry と同内容を維持） */
const STATIC_CAPABILITY_LINES = [
  "タスクの記録（やることリストに追加）",
  "メモの保存",
  "リマインドの受付（お時間の指定がはっきりしていると助かります）",
  "短い文章の要約・整理",
  "簡単な質問・雑談・学習・仕事の相談など、チャットで幅広くお答えします（スプレッドシート専用ではありません）",
  "Googleスプレッドシートの参照と分析（共有後、表に基づく集計・一覧・所感など）",
  "NEARができることのご案内（今お送りしている内容です）",
];

export async function helpCapabilities(ctx: ModuleContext): Promise<ModuleResult> {
  const lines = await listCapabilityLines(ctx.db);
  const body = [
    "はい、NEARで現在お手伝いできることは、ざっくり次のとおりです。",
    "",
    ...lines.map((l) => `・${l}`),
    "",
    "上記以外のお願いも、内容に応じてできる範囲で臨機応変にお受けします。まだ対応できない場合は記録し、できるよう改善してまいります。",
  ].join("\n");
  return { success: true, draft: body, situation: "success" };
}

/** capability_registry を参照。0件のときは静的フォールバック。 */
export async function listCapabilityLines(db: Db): Promise<string[]> {
  const r = await db.query<{ user_visible_line: string }>(
    `SELECT user_visible_line FROM capability_registry WHERE enabled = true ORDER BY sort_order ASC`
  );
  if (r.rows.length === 0) return [...STATIC_CAPABILITY_LINES];
  return r.rows.map((row) => row.user_visible_line);
}
