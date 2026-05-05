/**
 * Web 検索ツール付与の優先順位（検索しすぎ防止）。
 * NEAR_WEB_SEARCH_POLICY_ENABLED=false のときは呼び出し側で従来どおり NEAR_AGENT_WEB_SEARCH のみを参照する。
 *
 * ルール（先に一致したものが採用）:
 * 1. 明示キーワード（検索依頼・最新性/一次情報の要求）→ 付与
 * 2. ユーザー本文が minChars 未満 → 不付与（reason: text_too_short）
 * 3. ユーザー発話がスプレッドシート／表計算・カレンダー文脈に強い → 不付与（reason: sheet_or_calendar_context）
 *    （常時登録の near_google_sheets_query では判定しない。誤って検索を潰さないため）
 * 4. 上記以外 → 不付与（reason: default_no_search）
 */

const EXPLICIT_PATTERNS: RegExp[] = [
  /検索して|調べて|ググって|webで/,
  /最新の|いまの|今の|現在の|リアルタイム|速報/,
  /出典|ソース|根拠|一次情報|公式情報/,
  /公式.*(サイト|ページ)|原典|一次ソース/,
];

/** シート／カレンダー用途では外部検索より専用ツール・既知データを優先 */
const SHEET_OR_CAL_CONTEXT =
  /スプレッドシート|スプシ|グーグルシート|Google\s*スプレッドシート|この表|売上.*(シート|表)|在庫.*(シート|表)|セル|列[A-Z]|行\d|カレンダー|予定表|スケジュール(を|の)?(確認|見|空き)/i;

export type WebSearchPolicyResult = {
  attach: boolean;
  reasonCode: string;
};

export function evaluateWebSearchPolicy(input: { userText: string; minChars: number }): WebSearchPolicyResult {
  const t = input.userText.trim();
  if (EXPLICIT_PATTERNS.some((re) => re.test(t))) {
    return { attach: true, reasonCode: "explicit_keyword" };
  }
  if (t.length < input.minChars) {
    return { attach: false, reasonCode: "text_too_short" };
  }
  if (SHEET_OR_CAL_CONTEXT.test(t)) {
    return { attach: false, reasonCode: "sheet_or_calendar_context" };
  }
  return { attach: false, reasonCode: "default_no_search" };
}
