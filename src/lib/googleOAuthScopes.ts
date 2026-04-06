/** LINE ユーザー Google 連携で要求するスコープ（Sheets / Drive 名検索 / アカウント識別用 userinfo） */
export const GOOGLE_USER_SHEET_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
] as const;
