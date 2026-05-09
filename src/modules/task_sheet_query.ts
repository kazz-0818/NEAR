import { isValidSpreadsheetId } from "../lib/googleSheetsAuth.js";
import { sheetsQuery } from "./sheets_query.js";
import type { ModuleContext, ModuleResult } from "./types.js";

const LINE_SOFT_LIMIT = 4_900;

function asStringOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

function buildTaskSheetQuestion(ctx: ModuleContext): string {
  const p = (ctx.intent.required_params ?? {}) as Record<string, unknown>;
  const query = asStringOrNull(p.query) ?? ctx.originalText;
  const status = asStringOrNull(p.status);
  const assignee = asStringOrNull(p.assignee);
  const priority = asStringOrNull(p.priority);
  const dueFilter = asStringOrNull(p.due_filter);
  const sheetName = asStringOrNull(p.sheet_name);

  const filters: string[] = [];
  if (status) filters.push(`ステータス: ${status}`);
  if (assignee) filters.push(`担当者: ${assignee}`);
  if (priority) filters.push(`優先度: ${priority}`);
  if (dueFilter && dueFilter !== "none") filters.push(`期限フィルタ: ${dueFilter}`);
  if (sheetName) filters.push(`対象シート名: ${sheetName}`);

  const filterText = filters.length > 0 ? filters.join(" / ") : "指定なし";
  return [
    `${query}`,
    "",
    "あなたはタスク管理シートを読み取って回答します。次を厳守してください。",
    `- フィルタ条件: ${filterText}`,
    "- 対象は未完了タスクを優先（明示的に完了指定がある場合のみ完了を含める）",
    "- 件数が多い場合は最大10件までに絞る",
    "- LINEで見やすいよう次のフォーマットで返す:",
    "【未完了タスク一覧】",
    "1. タスク名",
    "　担当：",
    "　期限：",
    "　優先度：",
    "　指示：",
    "",
    "2. タスク名",
    "　担当：",
    "　期限：",
    "　優先度：",
    "　指示：",
    "",
    "- 10件に絞った場合、最後に「続きも見る場合は『続き』と送ってください」を必ず追記",
    "- タスクが0件なら、その旨を明確に返す",
  ].join("\n");
}

function mapNotFoundToFollowup(mod: ModuleResult): ModuleResult {
  if (mod.situation !== "followup") return mod;
  const t = mod.draft.normalize("NFKC");
  if (
    /見つかりませんでした|特定できませんでした|ファイル名|スプレッドシートのリンク|ぴったり/.test(t)
  ) {
    return {
      success: true,
      situation: "followup",
      draft: "タスクシートが見つかりませんでした。スプレッドシートURL、またはシート名を教えてください。",
    };
  }
  return mod;
}

function ensureLineLimit(draft: string): string {
  if (draft.length <= LINE_SOFT_LIMIT) return draft;
  const clipped = `${draft.slice(0, LINE_SOFT_LIMIT)}\n\n…（長文のため一部省略）`;
  return clipped;
}

export async function taskSheetQuery(ctx: ModuleContext): Promise<ModuleResult> {
  const p = (ctx.intent.required_params ?? {}) as Record<string, unknown>;
  const sidRaw = asStringOrNull(p.spreadsheet_id);

  const params: Record<string, unknown> = {};
  if (sidRaw && isValidSpreadsheetId(sidRaw)) {
    params.spreadsheet_id = sidRaw;
  }

  const delegated = await sheetsQuery({
    ...ctx,
    intent: { ...ctx.intent, required_params: params },
    originalText: buildTaskSheetQuestion(ctx),
  });

  const mapped = mapNotFoundToFollowup(delegated);
  return {
    ...mapped,
    draft: ensureLineLimit(mapped.draft),
  };
}
