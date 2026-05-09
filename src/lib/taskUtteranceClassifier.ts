export type TaskUtteranceKind =
  | "add_task"
  | "read_task_sheet"
  | "delete_task"
  | "update_task"
  | "ambiguous_task"
  | "not_task";

export type TaskUtteranceClassification = {
  kind: TaskUtteranceKind;
  confidence: number;
  extractedText?: string;
  targetNumber?: number;
  reason: string;
};

const TASK_WORD_RE = /(タスク|タスクリスト|todo|to\s*do|やること|やる事|リスト)/iu;
const SHEET_WORD_RE = /(スプレッ?ドシート|スプシ|spreadsheet|シート|タスク管理表|管理表)/iu;
const READ_WORD_RE =
  /(一覧|見せ|見たい|教えて|ある\??|あります\??|何がある|今日|未完了|進行中|優先度|指示|次やること|今残って|残ってる)/iu;
const ADD_WORD_RE =
  /(追加|入れて|登録|タスク化|タスクにして|todoに|やることに|覚えておいて|リスト.*入れ|入れといて|保存して)/iu;
const DELETE_WORD_RE = /(削除|消して|消去|消す|外して|外す|remove|delete)/iu;
const UPDATE_WORD_RE = /((?:^|[^未])完了|終わった|進行中にして|変更|修正|期限|担当|ステータス|優先度.*にして|内容修正)/iu;
const AMBIGUOUS_ONLY_RE =
  /^(タスク|リスト|todo|やること|あれやっといて|さっきのやつ|さっきのやつお願い|それお願い|管理して|整理して)$/iu;
const BULK_DELETE_RE = /(全部|全て|すべて|両方|二つとも|全消し|全削除)/iu;

function normalizeText(text: string): { raw: string; flat: string; lines: string[] } {
  const raw = text.normalize("NFKC").replace(/\r\n/g, "\n").trim();
  const flat = raw.replace(/\s+/g, " ").trim();
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return { raw, flat, lines };
}

function extractTargetNumber(flat: string): number | undefined {
  const m = flat.match(/([1-9][0-9]?)(?:番|ばん|つ目|個目)?(?:も)?(?=(?:を|は)?(?:\s)*(?:削除|消して|消去|外して|完了|終わった|終了|やった))/u)
    ?? flat.match(/(?:^|\s)([1-9][0-9]?)(?:番|ばん|つ目|個目)?(?:\s|$|も)/u);
  if (!m) return undefined;
  const n = Number.parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

function extractTaskTitle(raw: string, flat: string, lines: string[]): string | undefined {
  const explicit = flat.match(
    /(?:^|[\s、。])(.+?)(?:を|は)?(?:タスク|todo|to\s*do|やること)(?:リスト)?(?:に)?(?:追加|入れて|登録|にして|化して|へ)/iu
  );
  if (explicit?.[1]) return explicit[1].trim();

  const labeled = flat.match(/タスク追加[：:]\s*(.+)$/iu);
  if (labeled?.[1]) return labeled[1].trim();

  // 改行末尾に命令があるパターン: 「本文\nタスクリストに入れて」
  if (lines.length >= 2) {
    const last = lines[lines.length - 1] ?? "";
    if (/(タスク|todo|やること|リスト).*(追加|入れて|登録|にして|化して)|覚えておいて.*あとでやる/iu.test(last)) {
      const body = lines.slice(0, -1).join(" ").trim();
      if (body) return body;
    }
  }

  // 文全体が「〇〇をTODOへ」系
  const short = raw.match(/^(.+?)(?:を|は)?(?:todo|to\s*do|やること|タスク)(?:へ|に)?$/iu);
  if (short?.[1]) return short[1].trim();
  return undefined;
}

export function classifyTaskUtterance(text: string): TaskUtteranceClassification {
  const { raw, flat, lines } = normalizeText(text);
  if (!flat) return { kind: "not_task", confidence: 0.99, reason: "empty" };

  const hasTaskWord = TASK_WORD_RE.test(flat);
  const hasSheetWord = SHEET_WORD_RE.test(flat);
  const hasReadWord = READ_WORD_RE.test(flat);
  const hasAddWord = ADD_WORD_RE.test(flat);
  const hasDeleteWord = DELETE_WORD_RE.test(flat);
  const hasUpdateWord = UPDATE_WORD_RE.test(flat);
  const targetNumber = extractTargetNumber(flat);

  if (AMBIGUOUS_ONLY_RE.test(flat)) {
    return { kind: "ambiguous_task", confidence: 0.85, reason: "too_short_ambiguous" };
  }

  // シート語 + タスク話題 + 参照語 は task_line より先にシート読取へ寄せる
  if ((hasSheetWord && (hasTaskWord || /指示|未完了|進行中|優先度/u.test(flat)) && hasReadWord) || /タスク管理表/u.test(flat)) {
    return { kind: "read_task_sheet", confidence: 0.96, reason: "task_sheet_read_keywords" };
  }
  if (/今日の指示|指示一覧|未完了タスク|進行中のタスク|優先度高いタスク|次やること|今残ってるタスク/u.test(flat)) {
    return { kind: "read_task_sheet", confidence: 0.9, reason: "task_read_phrase" };
  }

  // 追加と参照が同時なら参照優先（「タスク一覧見せて」誤判定防止）
  if (hasAddWord && hasReadWord) {
    return { kind: "read_task_sheet", confidence: 0.78, reason: "add_and_read_conflict_read_preferred" };
  }

  if (hasAddWord || /タスク追加|タスク化|todoへ|やることに/u.test(flat)) {
    const extracted = extractTaskTitle(raw, flat, lines);
    return {
      kind: "add_task",
      confidence: extracted ? 0.92 : 0.75,
      extractedText: extracted,
      reason: extracted ? "add_with_title" : "add_without_title",
    };
  }

  if (hasDeleteWord || BULK_DELETE_RE.test(flat)) {
    const ambiguousTarget =
      BULK_DELETE_RE.test(flat) ||
      /これ|この|それ|さっき|上のやつ|やっぱ/u.test(flat) ||
      (!targetNumber && !/タスク名|「.+」/u.test(flat));
    return {
      kind: "delete_task",
      confidence: ambiguousTarget ? 0.68 : 0.9,
      targetNumber,
      reason: ambiguousTarget ? "delete_target_ambiguous" : "delete_target_specific",
    };
  }

  if (hasUpdateWord) {
    const ambiguousTarget = !targetNumber && /この|それ|さっき|上の/u.test(flat);
    return {
      kind: "update_task",
      confidence: ambiguousTarget ? 0.7 : 0.88,
      targetNumber,
      reason: ambiguousTarget ? "update_target_ambiguous" : "update_keywords",
    };
  }

  if (hasTaskWord && hasReadWord) {
    return { kind: "read_task_sheet", confidence: 0.8, reason: "task_read_keywords" };
  }
  if (hasTaskWord) {
    return { kind: "ambiguous_task", confidence: 0.62, reason: "task_topic_but_unclear_action" };
  }
  return { kind: "not_task", confidence: 0.98, reason: "no_task_keywords" };
}
