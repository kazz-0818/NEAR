export type TaskUtteranceKind =
  | "add_task"
  | "local_task_list"
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

const TASK_WORD_RE = /(タスク|タスクリスト|todo|to\s*do|やること|やる事|リスト|指示|ガントチャート|管理表)/iu;
const SHEET_EXPLICIT_RE =
  /(スプレッ?ドシート|スプシ|google\s*シート|google\s*sheets?|spreadsheet|シート(?:から|で|を|の)?|タスク管理表|ガントチャート|表から|シートから)/iu;
const READ_WORD_RE =
  /(一覧|見せ|見たい|教えて|ある\??|あります\??|何がある|今日|未完了|進行中|優先度|指示|次やること|今残って|残ってる|出して|確認)/iu;
const ADD_WORD_RE =
  /(追加|入れて|タスク化|タスクにして|todoに|やることに|覚えておいて|リスト.*入れ|入れといて|保存して|登録して|(?:タスク|todo|やること).{0,6}登録)/iu;
const DELETE_WORD_RE = /(削除|消して|消去|消す|外して|外す|remove|delete)/iu;
const UPDATE_WORD_RE = /((?:^|[^未])完了|終わった|進行中にして|変更|修正|期限|担当|ステータス|優先度.*にして|内容修正)/iu;
const AMBIGUOUS_ONLY_RE =
  /^(タスク|リスト|todo|やること|あれやっといて|さっきのやつ|さっきのやつお願い|それお願い|管理して|整理して)$/iu;
const BULK_DELETE_RE = /(全部|全て|すべて|両方|二つとも|全消し|全削除)/iu;
const LOCAL_LIST_RE =
  /(タスク一覧|タスクリスト|todo一覧|やること一覧|今のタスク|現在のタスク|今日のタスク|登録したタスク|追加したタスク|俺のタスク|自分のタスク|残ってるタスク|残っているタスク|次やること何|今残ってるタスク何)/iu;
const SHEET_TASK_READ_RE =
  /(スプレッ?ドシート.*タスク|スプシ.*タスク|google\s*シート.*タスク|シート.*タスク|タスク管理表|ガントチャート|シート読んで.*タスク|シートから.*タスク|表から.*タスク)/iu;

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
  const hasSheetWord = SHEET_EXPLICIT_RE.test(flat);
  const hasReadWord = READ_WORD_RE.test(flat);
  const hasAddWord = ADD_WORD_RE.test(flat);
  const hasDeleteWord = DELETE_WORD_RE.test(flat);
  const hasUpdateWord = UPDATE_WORD_RE.test(flat);
  const targetNumber = extractTargetNumber(flat);

  if (AMBIGUOUS_ONLY_RE.test(flat)) {
    return { kind: "ambiguous_task", confidence: 0.85, reason: "too_short_ambiguous" };
  }

  // A. 明示シート指定があるタスク参照は read_task_sheet（local より優先）
  if (SHEET_TASK_READ_RE.test(flat) || (hasSheetWord && hasTaskWord && hasReadWord)) {
    return { kind: "read_task_sheet", confidence: 0.96, reason: "task_sheet_read_keywords" };
  }
  if (hasSheetWord && /見せ|見たい|読んで|出して|確認|教えて/u.test(flat)) {
    return { kind: "read_task_sheet", confidence: 0.9, reason: "explicit_sheet_read" };
  }

  // C. 追加は一覧より優先（「〇〇をタスクにして」）
  if (hasAddWord || /タスク追加|タスク化|todoへ|やることに/u.test(flat)) {
    const extracted = extractTaskTitle(raw, flat, lines);
    return {
      kind: "add_task",
      confidence: extracted ? 0.92 : 0.75,
      extractedText: extracted,
      reason: extracted ? "add_with_title" : "add_without_title",
    };
  }

  // B. シート明示がない一覧参照は local_task_list
  if (LOCAL_LIST_RE.test(flat) || (hasTaskWord && hasReadWord)) {
    return { kind: "local_task_list", confidence: 0.9, reason: "local_task_list_keywords" };
  }

  // D. 更新/削除
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

  if (hasTaskWord) {
    return { kind: "ambiguous_task", confidence: 0.62, reason: "task_topic_but_unclear_action" };
  }
  return { kind: "not_task", confidence: 0.98, reason: "no_task_keywords" };
}
