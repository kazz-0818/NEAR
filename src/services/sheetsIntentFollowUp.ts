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

/**
 * 「一覧出して」続けて「これ分析して」のように、URL 無しの続きを Sheets 参照に乗せる。
 * simple_question のみ上書き（他 intent は触らない）。
 */
const ANALYZE_OR_CONTINUE_SHEETS =
  /(これ|それ|上|さっき|先|直前|このデータ|この表|この一覧|一覧).{0,30}(見て|読んで|分析|解析|どう思|教えて|解説|コメント|判断|説明)|分析(して|できますか|できる)|見て.{0,12}(判断|どう|分析)|^ニア[,、\s]*(これ|それ|上).{0,25}(見て|分析)/i;

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
  if (!ANALYZE_OR_CONTINUE_SHEETS.test(text.trim())) return parsed;
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
