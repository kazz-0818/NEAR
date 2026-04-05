import { randomBytes } from "node:crypto";
import type { Db } from "../db/client.js";
import { getEffectivePublicBaseUrl } from "../lib/renderRuntime.js";
import { googleUserOAuthEnvConfigured } from "../lib/googleUserOAuthConfig.js";

/** LINE で「Google連携」等と送られたとき、ブラウザ用ワンタイム URL を返す */
export async function tryHandleGoogleOAuthUserLine(input: {
  db: Db;
  text: string;
  channelUserId: string;
}): Promise<{ handled: boolean; reply?: string }> {
  const t = input.text.normalize("NFKC").trim();
  if (!/(google|グーグル|ｇｏｏｇｌｅ)\s*連携/i.test(t)) {
    return { handled: false };
  }

  if (!googleUserOAuthEnvConfigured()) {
    return {
      handled: true,
      reply:
        "Google のユーザー連携は、いまのサーバーでは未設定です。管理者に `GOOGLE_OAUTH_CLIENT_ID` / `CLIENT_SECRET` / `REDIRECT_URI` / `GOOGLE_OAUTH_TOKEN_SECRET` の設定を依頼してください。",
    };
  }

  const base = getEffectivePublicBaseUrl();
  if (!base) {
    return {
      handled: true,
      reply:
        "連携用の公開 URL が分かりません。`PUBLIC_BASE_URL`（または Render の `RENDER_EXTERNAL_URL`）を管理者に設定してもらってから、もう一度「Google連携」と送ってください。",
    };
  }

  const token = randomBytes(32).toString("base64url");
  await input.db.query(
    `INSERT INTO google_oauth_link_tokens (token, line_user_id, expires_at)
     VALUES ($1, $2, now() + interval '15 minutes')`,
    [token, input.channelUserId]
  );

  const url = `${base}/oauth/google/start?link=${encodeURIComponent(token)}`;
  return {
    handled: true,
    reply: [
      "Google アカウントの権限でシートを読む連携ですね。",
      "",
      `次の URL を**15分以内**にブラウザで開き、許可してください:`,
      url,
      "",
      "完了後、あなたの Google で開けるスプレッドシートは、サービスアカウントへの共有なしで読み取れます（閲覧できる範囲のみ）。",
    ].join("\n"),
  };
}
