/**
 * シート読取成功レスの先頭マーカー（reply_composer のバイパス判定など）。
 * 文言を変えるときはここと buildSheetReadSuccessHeader を同時に直す。
 */
export const SHEET_READ_SUCCESS_HEADER_REGEX = /（参照:\s*シート「/;

export function buildSheetReadSuccessHeader(
  sheetTitle: string,
  lastRow: number,
  spreadsheetId: string
): string {
  const prefix = spreadsheetId.slice(0, 8);
  return `（参照: シート「${sheetTitle}」の先頭〜${lastRow}行・列ZZまで。ブックID ${prefix}…）\n\n`;
}
