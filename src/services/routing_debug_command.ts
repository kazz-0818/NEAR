/**
 * 管理者向けルーティング判定レポート用のフレーズ検出と整形。
 */

import type { RoutingTraceRow } from "./routing_trace_service.js";

/** ルーティングデバッグレポートを求める発話か */
export function isRoutingDebugQuery(text: string): boolean {
  const t = text.normalize("NFKC").trim();
  if (!t) return false;
  return (
    /なぜ(そう)?判断(した|して|なの)/u.test(t) ||
    /なんで(そう)?なった/u.test(t) ||
    /直前の判定(を)?(見せて|教えて|表示)/u.test(t) ||
    /ルート(確認|を見せて)/u.test(t) ||
    /ルーティング(確認|を見せて|判定)/u.test(t) ||
    /直前ログ(を)?(見せて|教えて)/u.test(t) ||
    /なぜDrive(に|へ)/u.test(t) ||
    /なぜスプレッドシート/u.test(t) ||
    /なぜGrowth/u.test(t) ||
    /なぜリマインド/u.test(t) ||
    /^ルーティング(確認|デバッグ)/u.test(t)
  );
}

export type OneClickImprovementKind =
  | "manual_bad_reply"
  | "manual_capsule"
  | "manual_context_miss"
  | "manual_wrong_route";

/** ワンクリック改善候補保存を求める発話か（即 Issue 化しない） */
export function matchOneClickImprovementQuery(text: string): OneClickImprovementKind | null {
  const t = text.normalize("NFKC").trim();
  if (!t) return null;
  if (/(今の返答おかしい|これはおかしい|返答がおかしい)/u.test(t)) return "manual_bad_reply";
  if (/(カプセル化して|今の会話をカプセル化|改善カプセルにして|改善候補にして)/u.test(t)) return "manual_capsule";
  if (/(文脈ミスとして保存|文脈がおかしい)/u.test(t)) return "manual_context_miss";
  if (/(ルーティングミスとして保存|ルートが違う)/u.test(t)) return "manual_wrong_route";
  return null;
}

export function triggerReasonForOneClick(kind: OneClickImprovementKind): string {
  switch (kind) {
    case "manual_bad_reply":
      return "manual_bad_reply_report";
    case "manual_capsule":
      return "manual_capsule_request";
    case "manual_context_miss":
      return "manual_context_miss_report";
    case "manual_wrong_route":
      return "manual_wrong_route_report";
    default:
      return "manual_bad_reply_report";
  }
}

function yn(v: boolean): string {
  return v ? "あり" : "なし";
}

function short(s: string | null | undefined, max = 220): string {
  if (s == null || s === "") return "（なし）";
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

/**
 * LINE 返信用の短いレポート（秘密・長文ログは含めない）
 */
export function formatRoutingDebugReportForLine(row: RoutingTraceRow): string {
  const lines: string[] = ["直前の判定です。", ""];
  lines.push("ユーザー発話：");
  lines.push(short(row.user_message, 300));
  lines.push("");
  lines.push(`判定ルート：${row.route}`);
  lines.push(`実行モジュール：${row.module_name ?? "（なし／LLM・定型のみ）"}`);
  lines.push(`intent：${row.intent ?? "（なし）"}`);
  if (row.confidence != null) lines.push(`confidence：${row.confidence}`);
  lines.push(`判定理由：${short(row.reason, 280)}`);
  lines.push("");
  lines.push("pending状態：");
  if (row.cleared_pending) {
    lines.push(`解除あり（種別: ${row.pending_type ?? "不明"}）`);
  } else if (row.used_pending) {
    lines.push(`利用あり（種別: ${row.pending_type ?? "不明"}）`);
  } else {
    lines.push("特になし");
  }
  lines.push("");
  lines.push(`LLM fallback：${yn(row.used_llm_fallback)}`);
  lines.push(`Growth：${yn(row.used_growth_pipeline)}`);
  lines.push(`改善カプセル候補ログ：${yn(row.used_improvement_capsule_candidate)}`);
  lines.push("");
  lines.push("外部利用フラグ：");
  lines.push(`Sheets: ${yn(row.sheet_used)} / Drive: ${yn(row.drive_used)} / リマインド: ${yn(row.reminder_used)} / タスク: ${yn(row.task_used)} / GitHub: ${yn(row.github_used)}`);
  lines.push("");
  lines.push("NEAR返信要約：");
  lines.push(short(row.final_reply_summary, 320));
  return lines.join("\n");
}
