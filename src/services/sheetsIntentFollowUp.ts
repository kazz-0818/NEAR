import { getEnv } from "../config/env.js";
import type { Db } from "../db/client.js";
import { sheetsReadIntegrationEnabled } from "../lib/userGoogleSheetsClient.js";
import type { ParsedIntent } from "../models/intent.js";
import { loadUserSpreadsheetDefault } from "../modules/sheets_query.js";

function extractSpreadsheetId(s: string): string | null {
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m?.[1] ?? null;
}

/** 今回の発言と、それより前のユーザー発言（古い順）からスプレッドシート ID を探す（新しい方優先） */
export function findSpreadsheetIdInUserThread(text: string, recentUserMessages: string[]): string | null {
  const fromNow = extractSpreadsheetId(text);
  if (fromNow) return fromNow;
  for (let i = recentUserMessages.length - 1; i >= 0; i--) {
    const id = extractSpreadsheetId(recentUserMessages[i]!);
    if (id) return id;
  }
  return null;
}

/** 会話内のユーザー発言にスプレッドシート URL が一度でも出ているか（続き質問の文脈があるか） */
function spreadsheetUrlInUserThread(text: string, recentUserMessages: string[]): boolean {
  if (extractSpreadsheetId(text)) return true;
  return recentUserMessages.some((m) => extractSpreadsheetId(m) != null);
}

/**
 * 既定シート／環境既定だけで Sheets に寄せるとき、**明らかに表・シートの話**と分かる語があるか。
 * （「2月の売上予想は？」のような一般質問を Sheets に誤送しない＝臨機応変に FAQ へ残す）
 */
const SHEETS_TOPIC_EXPLICIT =
  /シート|スプシ|スプレッド|spreadsheet|一覧を|一覧が|一覧に|表を|表の|表に|表データ|ブック|セル|先に(送|貼|共有)|このブック|この一覧|この表|既定の|読み取った|取り込ん|docs\.google\.com\/spreadsheets/i;

/**
 * 「一覧出して」続けて「これ分析して」のように、URL 無しの続きを Sheets 参照に乗せる。
 * simple_question のみ上書き（他 intent は触らない）。
 */
const ANALYZE_OR_CONTINUE_SHEETS =
  /(これ|それ|上|さっき|先|直前|このデータ|この表|この一覧|一覧).{0,30}(見て|読んで|分析|解析|どう思|教えて|解説|コメント|判断|説明)|分析(して|できますか|できる)|見て.{0,12}(判断|どう|分析)|^ニア[,、\s]*(これ|それ|上).{0,25}(見て|分析)/i;

/** 期間・集計・所感など、続きのシート質問（既定シート／スレ内 URL があるときだけ昇格に使う） */
const SHEETS_NUMERIC_OR_OPINION_FOLLOWUP =
  /\d{1,2}月(だけ|のみ|分)?\s*(の|で)?\s*(算出|集計|データ|結果|教えて|見て|出して|抽出|一覧|リスト|件|売上|売り上げ|売上高|売行|粗利|利益|実績|件数|個数|人数|台数|数量|注文|受注)|\d{1,2}月(について|の件|の分|の状況|の数字)|(?:^|[\s、。])(算出|集計|合計|平均(値)?|件数|内訳)(\s|を)?(して|してほしい|ください|お願い|できる)|どう思(う|います|いる)|所感|印象|読み取って|傾向|比較して|前年|先月|昨年|今月|四半期|\bQ[1-4]\b|増えた|減った|落ちた|上がった/i;

/**
 * URL 無しの「ざっくり」業務依頼（既定ブック＋タブ名の想定）。
 * 例: 購入代行シートの3月の売り上げを教えて／POPUPの件数は／在庫表で先月いくら
 */
function roughSheetsBusinessRequest(text: string): boolean {
  const t = text.trim();
  if (
    /(シート|スプシ|スプレッド).{0,55}(の|で|は)?\s*(売上|売り上げ|集計|件数|合計|平均|一覧|データ|数字|\d{1,2}月|先月|今月|昨日|教えて|ください|いくら|どのくらい|どれくらい)/i.test(
      t
    )
  ) {
    return true;
  }
  if (/(売上|売り上げ|件数|集計|一覧|実績|予算).{0,35}(シート|スプシ|表で|表の|タブ)/i.test(t)) return true;
  if (/(POPUP|ポップアップ|代行|在庫|受注|発注|売上|仕入).{0,25}(シート|表)/i.test(t)) return true;
  if (
    /(売上|売り上げ|件数|合計).{0,18}(教えて|ください|いくら|どのくらい|どれくらい)/i.test(t) &&
    /(シート|表|スプシ|\d{1,2}月|先月|今月|タブ|データ)/i.test(t)
  ) {
    return true;
  }
  return false;
}

export function looksLikeSheetsThreadFollowUp(text: string): boolean {
  const t = text.trim();
  return (
    ANALYZE_OR_CONTINUE_SHEETS.test(t) ||
    SHEETS_NUMERIC_OR_OPINION_FOLLOWUP.test(t) ||
    roughSheetsBusinessRequest(t)
  );
}

function looksLikeSpreadsheetId(id: string): boolean {
  return /^[a-zA-Z0-9-_]{20,}$/.test(id.trim());
}

export async function promoteGoogleSheetsFollowUp(
  text: string,
  parsed: ParsedIntent,
  recentUserMessages: string[],
  db: Db,
  channelUserId: string
): Promise<ParsedIntent> {
  if (parsed.intent !== "simple_question" && parsed.intent !== "summarize") return parsed;
  if (parsed.intent === "summarize" && !looksLikeSheetsThreadFollowUp(text)) return parsed;
  if (!looksLikeSheetsThreadFollowUp(text)) return parsed;
  if (!sheetsReadIntegrationEnabled()) return parsed;

  let id = findSpreadsheetIdInUserThread(text, recentUserMessages);
  if (!id) {
    id = (await loadUserSpreadsheetDefault(db, channelUserId)) ?? null;
  }
  if (!id) {
    const envId = getEnv().GOOGLE_SHEETS_DEFAULT_SPREADSHEET_ID?.trim() ?? "";
    if (looksLikeSpreadsheetId(envId)) id = envId;
  }
  if (!id) return parsed;

  const urlInThread = spreadsheetUrlInUserThread(text, recentUserMessages);
  if (!urlInThread) {
    const t = text.trim();
    const continuingTable = ANALYZE_OR_CONTINUE_SHEETS.test(t);
    const explicitSheetTopic = SHEETS_TOPIC_EXPLICIT.test(t);
    const roughBiz = roughSheetsBusinessRequest(t);
    const numericOrOpinion = SHEETS_NUMERIC_OR_OPINION_FOLLOWUP.test(t);
    if (!continuingTable && !explicitSheetTopic && !roughBiz && !numericOrOpinion) return parsed;
  }

  return {
    ...parsed,
    intent: "google_sheets_query",
    can_handle: true,
    required_params: { ...parsed.required_params, spreadsheet_id: id },
    needs_followup: false,
    followup_question: null,
    reason: "orchestrator_sheets_thread_followup",
    suggested_category: parsed.suggested_category,
  };
}
