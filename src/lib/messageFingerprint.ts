import crypto from "node:crypto";
import type { ParsedIntent } from "../models/intent.js";

export const IMPROVEMENT_KINDS = [
  "prompt_tune",
  "routing_fix",
  "new_module",
  "external_auth",
  "out_of_scope",
] as const;

export type ImprovementKind = (typeof IMPROVEMENT_KINDS)[number];

/** 同種依頼カウント用: NFKC・空白圧縮・絵文字除去 */
export function normalizeForFingerprint(text: string): string {
  let s = text.normalize("NFKC").trim().toLowerCase();
  s = s.replace(/\p{Extended_Pictographic}/gu, "");
  s = s.replace(/[\u3000\s]+/g, " ").trim();
  return s;
}

export function messageFingerprint(text: string): string {
  const n = normalizeForFingerprint(text);
  return crypto.createHash("sha256").update(n, "utf8").digest("hex");
}

const EXTERNAL_PAT =
  /google|gmail|カレンダー|calendar|notion|slack|teams|salesforce|github|oauth|認証|api連携|スプレッドシート|spreadsheet|ドライブ|drive/i;
const OUT_OF_SCOPE_PAT =
  /違法|犯罪|ハッキング|個人\s*情報\s*窃取|クレジット\s*カード|パスワード\s*を教え|殺|自殺/i;

/**
 * ルールベースの改善種別（LLM なし）。後続で feature_suggester が別途 improvement_kind を付与可能。
 */
export function inferImprovementKind(message: string, intent: ParsedIntent): ImprovementKind {
  if (OUT_OF_SCOPE_PAT.test(message) || OUT_OF_SCOPE_PAT.test(intent.reason ?? "")) {
    return "out_of_scope";
  }
  if (EXTERNAL_PAT.test(message)) {
    return "external_auth";
  }
  if (intent.intent === "unknown_custom_request") {
    return "new_module";
  }
  if (intent.can_handle === false) {
    return "new_module";
  }
  // 分類は既知だがルーティングできなかったケース（将来拡張用）
  return "routing_fix";
}
