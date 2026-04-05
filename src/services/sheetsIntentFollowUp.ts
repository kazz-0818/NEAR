import { getEnv } from "../config/env.js";
import type { Db } from "../db/client.js";
import { googleSheetsConfigured } from "../lib/googleSheetsAuth.js";
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
  /\d{1,2}月(だけ|のみ|分)?\s*(の|で)?\s*(算出|集計|データ|結果|教えて|見て|出して|抽出|一覧|リスト|件)|\d{1,2}月(について|の件|の分)|(?:^|[\s、。])(算出|集計|合計|平均(値)?|件数|内訳)(\s|を)?(して|してほしい|ください|お願い|できる)|どう思(う|います|いる)|所感|印象|読み取って|傾向|比較して|前年|先月|昨年|四半期|\bQ[1-4]\b|増えた|減った|落ちた|上がった/i;

export function looksLikeSheetsThreadFollowUp(text: string): boolean {
  const t = text.trim();
  return ANALYZE_OR_CONTINUE_SHEETS.test(t) || SHEETS_NUMERIC_OR_OPINION_FOLLOWUP.test(t);
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
  if (parsed.intent !== "simple_question") return parsed;
  if (!looksLikeSheetsThreadFollowUp(text)) return parsed;
  if (!googleSheetsConfigured()) return parsed;

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
    const continuingTable = ANALYZE_OR_CONTINUE_SHEETS.test(text.trim());
    const explicitSheetTopic = SHEETS_TOPIC_EXPLICIT.test(text);
    if (!continuingTable && !explicitSheetTopic) return parsed;
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
