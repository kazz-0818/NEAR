import { getEnv } from "../config/env.js";
import type { Db } from "../db/client.js";
import { loadUserSpreadsheetDefault } from "../db/user_sheet_defaults_repo.js";
import {
  getPendingSpreadsheetConfirm,
  isSpreadsheetConfirmAffirmative,
} from "../db/user_sheet_pending_confirm_repo.js";
import { isValidSpreadsheetId } from "../lib/googleSheetsAuth.js";
import { findSpreadsheetIdInUserThread, spreadsheetUrlInUserThread } from "../lib/spreadsheetThread.js";
import { sheetsReadIntegrationEnabled } from "../lib/userGoogleSheetsClient.js";
import type { ParsedIntent } from "../models/intent.js";
import {
  allowDefaultSheetPromotionWithoutUrl,
  explicitUnanchoredSheetReadIntent,
  looksLikeSheetsThreadFollowUp,
} from "./sheetsIntentPatterns.js";

/**
 * Drive 検索の「第一候補でよいか」に対し、短い肯定だけ `google_sheets_query` へ載せる（`sheets_query` 側で pending を消費して ID 確定）。
 */
export async function promoteSheetsPendingAffirmative(
  text: string,
  parsed: ParsedIntent,
  db: Db,
  channelUserId: string
): Promise<ParsedIntent> {
  if (!sheetsReadIntegrationEnabled()) return parsed;
  if (!isSpreadsheetConfirmAffirmative(text)) return parsed;
  const pending = await getPendingSpreadsheetConfirm(db, channelUserId);
  if (!pending || !isValidSpreadsheetId(pending.spreadsheetId)) return parsed;
  return {
    ...parsed,
    intent: "google_sheets_query",
    can_handle: true,
    required_params: { ...parsed.required_params },
    needs_followup: false,
    followup_question: null,
    reason: "orchestrator_sheets_pending_confirm_yes",
    suggested_category: parsed.suggested_category,
  };
}

/**
 * 「一覧出して」続けて「これ分析して」のように、URL 無しの続きを Sheets 参照に乗せる。
 * ブック ID が無くても、明らかにシート読取なら google_sheets_query へ回しフォローアップ文案にする（FAQ 空振り防止）。
 */
export async function promoteGoogleSheetsFollowUp(
  text: string,
  parsed: ParsedIntent,
  recentUserMessages: string[],
  db: Db,
  channelUserId: string
): Promise<ParsedIntent> {
  if (parsed.intent !== "simple_question" && parsed.intent !== "summarize") return parsed;
  if (parsed.intent === "summarize" && !looksLikeSheetsThreadFollowUp(text, recentUserMessages)) return parsed;
  if (!looksLikeSheetsThreadFollowUp(text, recentUserMessages)) return parsed;
  if (!sheetsReadIntegrationEnabled()) return parsed;

  let id =
    findSpreadsheetIdInUserThread(text, recentUserMessages) ??
    (await loadUserSpreadsheetDefault(db, channelUserId)) ??
    null;
  if (!id) {
    const envId = getEnv().GOOGLE_SHEETS_DEFAULT_SPREADSHEET_ID?.trim() ?? "";
    if (isValidSpreadsheetId(envId)) id = envId;
  }

  const urlInThread = spreadsheetUrlInUserThread(text, recentUserMessages);

  if (id) {
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

  if (explicitUnanchoredSheetReadIntent(text, recentUserMessages)) {
    return {
      ...parsed,
      intent: "google_sheets_query",
      can_handle: true,
      required_params: { ...parsed.required_params },
      needs_followup: false,
      followup_question: null,
      reason: "orchestrator_sheets_unanchored_read",
      suggested_category: parsed.suggested_category,
    };
  }

  return parsed;
}
