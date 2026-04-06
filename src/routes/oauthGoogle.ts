import { Hono } from "hono";
import { OAuth2Client } from "google-auth-library";
import { getPool } from "../db/client.js";
import { getEnv } from "../config/env.js";
import { getLogger } from "../lib/logger.js";
import { encryptRefreshToken } from "../lib/googleOAuthTokenCrypto.js";
import { GOOGLE_USER_SHEET_SCOPES } from "../lib/googleOAuthScopes.js";
import { googleUserOAuthEnvConfigured } from "../lib/googleUserOAuthConfig.js";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function oauthClient(): OAuth2Client {
  const env = getEnv();
  return new OAuth2Client(
    env.GOOGLE_OAUTH_CLIENT_ID!,
    env.GOOGLE_OAUTH_CLIENT_SECRET!,
    env.GOOGLE_OAUTH_REDIRECT_URI!
  );
}

export function createGoogleOAuthApp(): Hono {
  const app = new Hono();
  const log = getLogger();

  app.get("/start", async (c) => {
    if (!googleUserOAuthEnvConfigured()) {
      return c.text("Google ユーザー連携はサーバー未設定です。", 503);
    }
    const link = c.req.query("link")?.trim() ?? "";
    if (!link) return c.text("link パラメータが必要です。", 400);

    const db = getPool();
    const r = await db.query<{ line_user_id: string }>(
      `SELECT line_user_id FROM google_oauth_link_tokens WHERE token = $1 AND expires_at > now()`,
      [link]
    );
    const lineUserId = r.rows[0]?.line_user_id;
    if (!lineUserId) {
      return c.text(
        "リンクの有効期限が切れているか無効です。LINE で「Google連携」をもう一度送ってください。",
        400
      );
    }

    const client = oauthClient();
    const url = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [...GOOGLE_USER_SHEET_SCOPES],
      state: link,
    });
    return c.redirect(url, 302);
  });

  app.get("/callback", async (c) => {
    if (!googleUserOAuthEnvConfigured()) {
      return c.text("Google ユーザー連携はサーバー未設定です。", 503);
    }
    const err = c.req.query("error");
    const desc = c.req.query("error_description") ?? "";
    if (err) {
      return c.html(
        `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>連携エラー</title></head><body><p>連携がキャンセルまたは拒否されました。</p><p>${esc(err)} ${esc(desc)}</p></body></html>`,
        400
      );
    }
    const code = c.req.query("code");
    const state = c.req.query("state")?.trim() ?? "";
    if (!code || !state) return c.text("パラメータ不足です。", 400);

    const db = getPool();
    const linkRow = await db.query<{ line_user_id: string }>(
      `SELECT line_user_id FROM google_oauth_link_tokens WHERE token = $1 AND expires_at > now()`,
      [state]
    );
    const lineUserId = linkRow.rows[0]?.line_user_id;
    if (!lineUserId) {
      return c.text("セッションが無効です。LINE で「Google連携」からやり直してください。", 400);
    }

    try {
      const client = oauthClient();
      const { tokens } = await client.getToken(code);
      const refresh = tokens.refresh_token;
      if (!refresh) {
        return c.html(
          `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"></head><body><p>refresh_token が取得できませんでした。Google アカウントの選択画面で「オフラインアクセス」を許可するか、もう一度「Google連携」から試してください。</p></body></html>`,
          400
        );
      }
      const env = getEnv();
      const cipher = encryptRefreshToken(refresh, env.GOOGLE_OAUTH_TOKEN_SECRET!);
      await db.query(
        `INSERT INTO user_google_oauth (line_user_id, refresh_token_ciphertext, scope, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (line_user_id) DO UPDATE SET
           refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
           scope = EXCLUDED.scope,
           updated_at = now()`,
        [lineUserId, cipher, tokens.scope ?? GOOGLE_USER_SHEET_SCOPES.join(" ")]
      );
      await db.query(`DELETE FROM google_oauth_link_tokens WHERE token = $1`, [state]);
    } catch (e) {
      log.warn({ err: e }, "google oauth callback failed");
      return c.html(
        `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"></head><body><p>トークン取得に失敗しました。しばらくしてからもう一度お試しください。</p></body></html>`,
        500
      );
    }

    return c.html(
      `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>連携完了</title></head><body style="font-family:system-ui,sans-serif;padding:1.5rem;line-height:1.5"><h1>連携できました</h1><p>このウィンドウを閉じて、LINE の NEAR に戻ってください。</p><p>スプレッドシートは <strong>URL を送らなくても</strong>、あなたの Google ドライブ上の<strong>ファイル名</strong>から探せる場合があります。見つからないときだけ共有リンクを送ってください。</p></body></html>`
    );
  });

  return app;
}
