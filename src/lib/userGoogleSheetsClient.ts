import { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";
import type { drive_v3 } from "googleapis";
import type { sheets_v4 } from "googleapis";
import type { Db } from "../db/client.js";
import { getEnv } from "../config/env.js";
import {
  listGoogleOAuthTokenPairsOrdered,
  resolveRefreshTokenForSheets,
} from "../db/user_google_oauth_accounts_repo.js";
import { getDriveAPI, getSheetsAPI, googleSheetsConfigured, parseServiceAccountJson } from "./googleSheetsAuth.js";
import { googleUserOAuthEnvConfigured } from "./googleUserOAuthConfig.js";

export type SheetsAndDrive = { sheets: sheets_v4.Sheets; drive: drive_v3.Drive };

const SERVICE_ACCOUNT_ENTRY_SUB = "__service_account__";

export type SheetsDriveClientEntry = {
  googleSub: string;
  clients: SheetsAndDrive;
  isServiceAccount: boolean;
};

function createSheetsAndDriveFromRefreshToken(refreshTokenPlain: string): SheetsAndDrive {
  const env = getEnv();
  const oauth2 = new OAuth2Client(
    env.GOOGLE_OAUTH_CLIENT_ID!.trim(),
    env.GOOGLE_OAUTH_CLIENT_SECRET!.trim(),
    env.GOOGLE_OAUTH_REDIRECT_URI!.trim()
  );
  oauth2.setCredentials({ refresh_token: refreshTokenPlain });
  return {
    sheets: google.sheets({ version: "v4", auth: oauth2 }),
    drive: google.drive({ version: "v3", auth: oauth2 }),
  };
}

/**
 * Sheets 読み取りで**順に試す**ためのクライアント一覧。
 * 連携済み Google を（一覧と同じ順）すべて含め、最後にサービスアカウントがあれば追加。
 */
export async function listSheetsAndDriveClientsOrdered(db: Db, lineUserId: string): Promise<SheetsDriveClientEntry[]> {
  const out: SheetsDriveClientEntry[] = [];
  if (googleUserOAuthEnvConfigured()) {
    const pairs = await listGoogleOAuthTokenPairsOrdered(db, lineUserId);
    for (const p of pairs) {
      out.push({
        googleSub: p.googleSub,
        clients: createSheetsAndDriveFromRefreshToken(p.refreshTokenPlain),
        isServiceAccount: false,
      });
    }
  }
  if (googleSheetsConfigured()) {
    out.push({
      googleSub: SERVICE_ACCOUNT_ENTRY_SUB,
      clients: {
        sheets: await getSheetsAPI(),
        drive: await getDriveAPI(),
      },
      isServiceAccount: true,
    });
  }
  return out;
}

export function sheetsReadIntegrationEnabled(): boolean {
  return googleSheetsConfigured() || googleUserOAuthEnvConfigured();
}

/**
 * 本番の設定切れ調査用（秘密は出さない）。`/health` に載せる。
 */
export function getSheetsIntegrationDiagnostics(): {
  sheets_read_integration_enabled: boolean;
  oauth_env_fully_configured: boolean;
  oauth_client_id_set: boolean;
  oauth_client_secret_set: boolean;
  oauth_redirect_uri_set: boolean;
  oauth_token_secret_ok: boolean;
  service_account_env_nonempty: boolean;
  service_account_credentials_parse_ok: boolean;
} {
  const env = getEnv();
  const saNonempty = !!(env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() || env.GOOGLE_SERVICE_ACCOUNT_JSON_B64?.trim());
  const j = parseServiceAccountJson();
  const saOk = !!(j && typeof j.client_email === "string" && typeof j.private_key === "string");
  const oauthFull = googleUserOAuthEnvConfigured();
  return {
    sheets_read_integration_enabled: googleSheetsConfigured() || oauthFull,
    oauth_env_fully_configured: oauthFull,
    oauth_client_id_set: !!env.GOOGLE_OAUTH_CLIENT_ID?.trim(),
    oauth_client_secret_set: !!env.GOOGLE_OAUTH_CLIENT_SECRET?.trim(),
    oauth_redirect_uri_set: !!env.GOOGLE_OAUTH_REDIRECT_URI?.trim(),
    oauth_token_secret_ok: !!env.GOOGLE_OAUTH_TOKEN_SECRET?.trim(),
    service_account_env_nonempty: saNonempty,
    service_account_credentials_parse_ok: saOk,
  };
}

async function loadUserRefreshTokenPlain(db: Db, lineUserId: string): Promise<string | null> {
  if (!googleUserOAuthEnvConfigured()) return null;
  const resolved = await resolveRefreshTokenForSheets(db, lineUserId);
  return resolved?.refreshTokenPlain ?? null;
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
