import { extractSpreadsheetIdFromText } from "./googleSheetsAuth.js";

/** 今回の発言と、それより前のユーザー発言（古い順）からスプレッドシート ID を探す（新しい方優先） */
export function findSpreadsheetIdInUserThread(text: string, recentUserMessages: string[]): string | null {
  const fromNow = extractSpreadsheetIdFromText(text);
  if (fromNow) return fromNow;
  for (let i = recentUserMessages.length - 1; i >= 0; i--) {
    const id = extractSpreadsheetIdFromText(recentUserMessages[i]!);
    if (id) return id;
  }
  return null;
}

export function spreadsheetUrlInUserThread(text: string, recentUserMessages: string[]): boolean {
  return findSpreadsheetIdInUserThread(text, recentUserMessages) != null;
}
