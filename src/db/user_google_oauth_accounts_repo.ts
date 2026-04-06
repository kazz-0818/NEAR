import type { Db } from "./client.js";
import { getEnv } from "../config/env.js";
import { decryptRefreshToken } from "../lib/googleOAuthTokenCrypto.js";

export type GoogleAccountListItem = {
  googleSub: string;
  email: string | null;
  isActive: boolean;
  updatedAt: Date;
};

export async function upsertGoogleOAuthAccount(
  db: Db,
  lineUserId: string,
  googleSub: string,
  email: string | null,
  ciphertext: string,
  scope: string
): Promise<void> {
  await db.query(
    `INSERT INTO user_google_oauth_accounts (
       line_user_id, google_sub, email, refresh_token_ciphertext, scope, updated_at
     ) VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (line_user_id, google_sub) DO UPDATE SET
       email = COALESCE(EXCLUDED.email, user_google_oauth_accounts.email),
       refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
       scope = EXCLUDED.scope,
       updated_at = now()`,
    [lineUserId, googleSub, email, ciphertext, scope]
  );
}

export async function setActiveGoogleAccount(db: Db, lineUserId: string, googleSub: string): Promise<void> {
  await db.query(
    `INSERT INTO user_google_active_oauth (line_user_id, google_sub, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (line_user_id) DO UPDATE SET
       google_sub = EXCLUDED.google_sub,
       updated_at = now()`,
    [lineUserId, googleSub]
  );
}

export async function listGoogleAccountsForLine(db: Db, lineUserId: string): Promise<GoogleAccountListItem[]> {
  const r = await db.query<{
    google_sub: string;
    email: string | null;
    is_active: boolean;
    updated_at: Date;
  }>(
    `SELECT a.google_sub, a.email,
            (act.google_sub IS NOT NULL AND act.google_sub = a.google_sub) AS is_active,
            a.updated_at
     FROM user_google_oauth_accounts a
     LEFT JOIN user_google_active_oauth act ON act.line_user_id = a.line_user_id
     WHERE a.line_user_id = $1
     ORDER BY is_active DESC, a.updated_at DESC`,
    [lineUserId]
  );
  return r.rows.map((row) => ({
    googleSub: row.google_sub,
    email: row.email,
    isActive: row.is_active,
    updatedAt: row.updated_at,
  }));
}

/**
 * 一覧と同じ順（アクティブ優先 → 更新が新しい順）で、復号できるトークンだけ返す。
 */
export async function listGoogleOAuthTokenPairsOrdered(
  db: Db,
  lineUserId: string
): Promise<Array<{ googleSub: string; refreshTokenPlain: string }>> {
  const accounts = await listGoogleAccountsForLine(db, lineUserId);
  const out: Array<{ googleSub: string; refreshTokenPlain: string }> = [];
  for (const a of accounts) {
    const rt = await loadDecryptedRefreshToken(db, lineUserId, a.googleSub);
    if (rt) out.push({ googleSub: a.googleSub, refreshTokenPlain: rt });
  }
  return out;
}

export async function getActiveGoogleSub(db: Db, lineUserId: string): Promise<string | null> {
  const r = await db.query<{ google_sub: string }>(
    `SELECT google_sub FROM user_google_active_oauth WHERE line_user_id = $1`,
    [lineUserId]
  );
  return r.rows[0]?.google_sub ?? null;
}

async function loadDecryptedRefreshToken(
  db: Db,
  lineUserId: string,
  googleSub: string
): Promise<string | null> {
  const secret = getEnv().GOOGLE_OAUTH_TOKEN_SECRET?.trim();
  if (!secret || secret.length < 16) return null;
  const r = await db.query<{ refresh_token_ciphertext: string }>(
    `SELECT refresh_token_ciphertext FROM user_google_oauth_accounts
     WHERE line_user_id = $1 AND google_sub = $2`,
    [lineUserId, googleSub]
  );
  const row = r.rows[0];
  if (!row?.refresh_token_ciphertext) return null;
  try {
    return decryptRefreshToken(row.refresh_token_ciphertext, secret);
  } catch {
    return null;
  }
}

/**
 * アクティブが無効なら、最新更新のアカウントにフォールバックして返す。
 */
export async function resolveRefreshTokenForSheets(
  db: Db,
  lineUserId: string
): Promise<{ googleSub: string; refreshTokenPlain: string } | null> {
  const accounts = await listGoogleAccountsForLine(db, lineUserId);
  if (accounts.length === 0) return null;

  let sub = await getActiveGoogleSub(db, lineUserId);
  if (!sub || !accounts.some((a) => a.googleSub === sub)) {
    sub = accounts[0].googleSub;
    await setActiveGoogleAccount(db, lineUserId, sub);
  }

  let rt = await loadDecryptedRefreshToken(db, lineUserId, sub);
  if (rt) return { googleSub: sub, refreshTokenPlain: rt };

  for (const a of accounts) {
    if (a.googleSub === sub) continue;
    rt = await loadDecryptedRefreshToken(db, lineUserId, a.googleSub);
    if (rt) {
      await setActiveGoogleAccount(db, lineUserId, a.googleSub);
      return { googleSub: a.googleSub, refreshTokenPlain: rt };
    }
  }
  return null;
}

/** id_token のペイロードから sub / email を取る（追加リクエスト不要） */
export function extractSubFromIdToken(tokens: { id_token?: string | null }): { sub: string; email: string | null } | null {
  const id = tokens.id_token;
  if (!id || typeof id !== "string") return null;
  const parts = id.split(".");
  if (parts.length < 2) return null;
  try {
    const json = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
    const sub = json.sub;
    if (typeof sub !== "string" || !sub) return null;
    const email = json.email;
    return { sub, email: typeof email === "string" ? email : null };
  } catch {
    return null;
  }
}
