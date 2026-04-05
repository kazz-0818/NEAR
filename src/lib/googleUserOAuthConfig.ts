import { getEnv } from "../config/env.js";

/** ユーザー OAuth 連携（ブラウザフロー）が環境変数だけで利用可能か */
export function googleUserOAuthEnvConfigured(): boolean {
  try {
    const e = getEnv();
    return Boolean(
      e.GOOGLE_OAUTH_CLIENT_ID?.trim() &&
        e.GOOGLE_OAUTH_CLIENT_SECRET?.trim() &&
        e.GOOGLE_OAUTH_REDIRECT_URI?.trim() &&
        e.GOOGLE_OAUTH_TOKEN_SECRET?.trim()
    );
  } catch {
    return false;
  }
}
