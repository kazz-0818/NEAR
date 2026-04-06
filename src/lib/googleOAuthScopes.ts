/** LINE ユーザー Google 連携で要求するスコープ（Sheets 読取 + Drive 上のスプレッドシート名検索） */
export const GOOGLE_USER_SHEET_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
] as const;
