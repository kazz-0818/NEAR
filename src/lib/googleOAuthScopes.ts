/** LINE ユーザー Google 連携で要求するスコープ（Sheets / Drive / Calendar / userinfo） */
export const GOOGLE_USER_OAUTH_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  /** 予定の一覧・追加（primary カレンダー） */
  "https://www.googleapis.com/auth/calendar.events",
] as const;

/** @deprecated 互換名。OAuth は `GOOGLE_USER_OAUTH_SCOPES` を使う */
export const GOOGLE_USER_SHEET_SCOPES = GOOGLE_USER_OAUTH_SCOPES;
