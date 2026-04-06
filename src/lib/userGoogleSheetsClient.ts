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
import { getDriveAPI, getSheetsAPI, googleSheetsConfigured } from "./googleSheetsAuth.js";
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
