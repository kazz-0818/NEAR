import { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";
import type { drive_v3 } from "googleapis";
import type { sheets_v4 } from "googleapis";
import type { Db } from "../db/client.js";
import { getEnv } from "../config/env.js";
import { decryptRefreshToken } from "./googleOAuthTokenCrypto.js";
import { getDriveAPI, getSheetsAPI, googleSheetsConfigured } from "./googleSheetsAuth.js";
import { googleUserOAuthEnvConfigured } from "./googleUserOAuthConfig.js";

export type SheetsAndDrive = { sheets: sheets_v4.Sheets; drive: drive_v3.Drive };

export function sheetsReadIntegrationEnabled(): boolean {
  return googleSheetsConfigured() || googleUserOAuthEnvConfigured();
}

async function loadUserRefreshTokenPlain(db: Db, lineUserId: string): Promise<string | null> {
  if (!googleUserOAuthEnvConfigured()) return null;
  const env = getEnv();
  const secret = env.GOOGLE_OAUTH_TOKEN_SECRET!.trim();
  const r = await db.query<{ refresh_token_ciphertext: string }>(
    `SELECT refresh_token_ciphertext FROM user_google_oauth WHERE line_user_id = $1`,
    [lineUserId]
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
 * Sheets + Drive クライアント。**ユーザー OAuth があれば優先**、なければサービスアカウント。
 * リンク無しのスプレッドシート特定には Drive の files.list を使う。
 */
export async function getSheetsAndDriveForLineUser(db: Db, lineUserId: string): Promise<SheetsAndDrive | null> {
  const rt = await loadUserRefreshTokenPlain(db, lineUserId);
  if (rt && googleUserOAuthEnvConfigured()) {
    const env = getEnv();
    const oauth2 = new OAuth2Client(
      env.GOOGLE_OAUTH_CLIENT_ID!.trim(),
      env.GOOGLE_OAUTH_CLIENT_SECRET!.trim(),
      env.GOOGLE_OAUTH_REDIRECT_URI!.trim()
    );
    oauth2.setCredentials({ refresh_token: rt });
    return {
      sheets: google.sheets({ version: "v4", auth: oauth2 }),
      drive: google.drive({ version: "v3", auth: oauth2 }),
    };
  }
  if (googleSheetsConfigured()) {
    return {
      sheets: await getSheetsAPI(),
      drive: await getDriveAPI(),
    };
  }
  return null;
}

/**
 * Sheets のみ（Drive が不要な呼び出し向け）。
 */
export async function getSheetsForLineUser(db: Db, lineUserId: string): Promise<sheets_v4.Sheets | null> {
  const both = await getSheetsAndDriveForLineUser(db, lineUserId);
  return both?.sheets ?? null;
}
