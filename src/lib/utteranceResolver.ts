import { normalizeUserUtterance } from "./utteranceNormalizer.js";

export type ResolvedOperationKind =
  | "task.add"
  | "task.list.local"
  | "task.list.sheet"
  | "task.update"
  | "task.delete"
  | "task.clarify"
  | "memo.save"
  | "reminder.create"
  | "sheet.query"
  | "calendar.query"
  | "general.chat"
  | "unknown";

export type ResolvedOperation = {
  kind: ResolvedOperationKind;
  confidence: number;
  extractedText?: string;
  targetNumber?: number;
  requiresConfirmation?: boolean;
  reason: string;
};

const TASK_WORD_RE = /(タスク|タスクリスト|todo|やること|指示|リスト|ガントチャート|タスク管理表)/iu;
const SHEET_EXPLICIT_RE =
  /(スプレッドシート|スプシ|googleシート|シート|タスク管理表|ガントチャート|表から|シートから)/iu;
const ADD_WORD_RE =
  /(追加|入れて|タスク化|タスクにして|todoに|やることに|覚え(?:て|と)いて|後でやるやつにして|リスト.*入れ|入れといて|保存して|登録して|(?:タスク|todo|やること).{0,6}登録)/iu;
const LOCAL_LIST_RE =
  /(タスク一覧|タスクリスト|タスク見せて|今のタスク|登録したタスク|追加したタスク|todo一覧|やること一覧|今日やること|今日のタスク|残ってるタスク|残っているタスク|俺のタスク|自分のタスク|まだ残ってるやつ|何やるんだっけ)/iu;
const SHEET_TASK_LIST_RE =
  /(スプレッドシート.*タスク|スプシ.*タスク|スプレッド.*タスク|シート.*タスク|googleシート.*タスク|ガントチャート.*(見せ|出して|確認|教えて)?|タスク管理表.*(見せ|出して|確認|教えて)?|シートから.*タスク|表から.*タスク)/iu;
const DELETE_WORD_RE = /(削除|消して|消去|消す|外して|外す|remove|delete)/iu;
const UPDATE_WORD_RE = /(完了|終わった|進行中にして|変更|修正|期限|担当|ステータス|内容修正|優先度.*にして)/iu;
const MEMO_RE = /(メモ|覚えて|記録して|残して)/iu;
const REMINDER_RE = /(リマインド|思い出させ|通知して|アラーム|明日|今日|分後|時間後|月\d+日|時)/iu;
const CALENDAR_RE = /(カレンダー|予定|予定表|googleカレンダー|予定入れて|予定追加|予定確認)/iu;
const AMBIGUOUS_TASK_RE = /^(タスク|リスト|todo|やること|あれやっといて|さっきのやつ(お願い)?|それお願い|整理して|管理して)$/iu;

function extractTargetNumber(compact: string): number | undefined {
  const m = compact.match(/([1-9][0-9]?)(?:番|ばん|つ目|個目)?(?:も)?(?=(?:を|は)?\s*(?:削除|消して|消去|外して|完了|終わった|終了|やった))/u)
    ?? compact.match(/(?:^|\s)([1-9][0-9]?)(?:番|ばん|つ目|個目)?(?:\s|$|も)/u);
  if (!m) return undefined;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function extractTaskText(normalized: string, compact: string, lines: string[]): string | undefined {
  const inline = compact.match(
    /(?:^|[\s、。])(.+?)(?:を|は)?(?:タスク|todo|やること)(?:リスト)?(?:に)?(?:追加|入れて|登録|にして|化して|へ)/iu
  );
  if (inline?.[1]) return inline[1].trim();

  const labeled = compact.match(/タスク追加[：:]\s*(.+)$/iu);
  if (labeled?.[1]) return labeled[1].trim();

  if (lines.length >= 2) {
    const last = lines[lines.length - 1] ?? "";
    if (/(タスク|todo|やること|リスト).*(追加|入れて|登録|にして|化して)|覚え(?:て|と)いて.*あとでやる/iu.test(last)) {
      const body = lines.slice(0, -1).join(" ").trim();
      if (body) return body;
    }
  }

  const short = normalized.match(/^(.+?)(?:を|は)?(?:todo|やること|タスク)(?:へ|に)?$/iu);
  if (short?.[1]) return short[1].trim();
  return undefined;
}

function hadRecentTaskListContext(recentAssistantMessages?: string[]): boolean {
  if (!recentAssistantMessages?.length) return false;
  return recentAssistantMessages.some((m) => /📋\s*タスク一覧/u.test(m.normalize("NFKC")));
}

export function resolveUserOperation(input: {
  text: string;
  recentUserMessages?: string[];
  recentAssistantMessages?: string[];
}): ResolvedOperation {
  const { normalized, compact, lines } = normalizeUserUtterance(input.text);
  if (!compact) return { kind: "unknown", confidence: 0.99, reason: "empty" };

  const hasTaskWord = TASK_WORD_RE.test(compact);
  const hasSheetWord = SHEET_EXPLICIT_RE.test(compact);
  const hasAddWord = ADD_WORD_RE.test(compact);
  const hasDeleteWord = DELETE_WORD_RE.test(compact);
  const hasUpdateWord = UPDATE_WORD_RE.test(compact);
  const hasRecentTaskList = hadRecentTaskListContext(input.recentAssistantMessages);
  const targetNumber = extractTargetNumber(compact);

  if (SHEET_TASK_LIST_RE.test(compact) || (hasSheetWord && hasTaskWord)) {
    return { kind: "task.list.sheet", confidence: 0.97, reason: "explicit_sheet_task_reference" };
  }

  if (hasAddWord) {
    const extracted = extractTaskText(normalized, compact, lines);
    return {
      kind: "task.add",
      confidence: extracted ? 0.93 : 0.78,
      extractedText: extracted,
      reason: extracted ? "task_add_with_text" : "task_add_without_text",
    };
  }

  if (LOCAL_LIST_RE.test(compact) || (hasTaskWord && /(一覧|見せ|見たい|何|ある\??|あります\??|残って|今日)/iu.test(compact))) {
    return { kind: "task.list.local", confidence: 0.9, reason: "local_task_list_request" };
  }

  if (hasDeleteWord) {
    const requiresConfirmation =
      /(全部|全て|すべて|両方|二つとも|これも|それ|この|さっき|上のやつ|やっぱ)/iu.test(compact) ||
      (!targetNumber && !/「.+」|タスク名/u.test(compact)) ||
      (/[1-9][0-9]?(?:番)?も\s*(?:消して|削除|消去)/u.test(compact) && !hasRecentTaskList);
    return {
      kind: "task.delete",
      confidence: requiresConfirmation ? 0.72 : 0.9,
      targetNumber,
      requiresConfirmation,
      reason: requiresConfirmation ? "delete_target_ambiguous" : "delete_target_specific",
    };
  }

  if (hasUpdateWord) {
    const requiresConfirmation = !targetNumber && /(この|それ|さっき|上の|対象|その)/iu.test(compact);
    return {
      kind: "task.update",
      confidence: requiresConfirmation ? 0.73 : 0.88,
      targetNumber,
      requiresConfirmation,
      reason: requiresConfirmation ? "update_target_ambiguous" : "task_update_request",
    };
  }

  if (AMBIGUOUS_TASK_RE.test(compact) || (hasTaskWord && compact.length <= 12)) {
    return { kind: "task.clarify", confidence: 0.8, reason: "task_action_unspecified" };
  }

  if (MEMO_RE.test(compact) && !hasTaskWord) {
    return { kind: "memo.save", confidence: 0.66, reason: "memo_keywords" };
  }
  if (REMINDER_RE.test(compact) && /(リマインド|通知|思い出させ|分後|時間後|明日|今日|時)/iu.test(compact)) {
    return { kind: "reminder.create", confidence: 0.68, reason: "reminder_keywords" };
  }
  if (CALENDAR_RE.test(compact)) {
    return { kind: "calendar.query", confidence: 0.66, reason: "calendar_keywords" };
  }
  if (hasSheetWord) {
    return { kind: "sheet.query", confidence: 0.62, reason: "non_task_sheet_reference" };
  }

  if (compact.length <= 2) return { kind: "unknown", confidence: 0.55, reason: "too_short" };
  return { kind: "general.chat", confidence: 0.6, reason: "fallback_general_chat" };
}
