import { getEnv } from "../config/env.js";
import type { Db } from "../db/client.js";
import { loadUserSpreadsheetDefault } from "../db/user_sheet_defaults_repo.js";
import { isValidSpreadsheetId } from "../lib/googleSheetsAuth.js";
import { findSpreadsheetIdInUserThread, spreadsheetUrlInUserThread } from "../lib/spreadsheetThread.js";
import { sheetsReadIntegrationEnabled } from "../lib/userGoogleSheetsClient.js";
import type { ParsedIntent } from "../models/intent.js";
import {
  allowDefaultSheetPromotionWithoutUrl,
  looksLikeSheetsThreadFollowUp,
} from "./sheetsIntentPatterns.js";

/**
 * 「一覧出して」続けて「これ分析して」のように、URL 無しの続きを Sheets 参照に乗せる。
 * simple_question のみ上書き（他 intent は触らない）。
 */
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
    if (isValidSpreadsheetId(envId)) id = envId;
  }
  if (!id) return parsed;

  const urlInThread = spreadsheetUrlInUserThread(text, recentUserMessages);
  if (!urlInThread && !allowDefaultSheetPromotionWithoutUrl(text)) return parsed;

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
