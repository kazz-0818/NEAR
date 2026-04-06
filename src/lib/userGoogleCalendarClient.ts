import { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";
import type { calendar_v3 } from "googleapis";
import type { Db } from "../db/client.js";
import { getEnv } from "../config/env.js";
import { resolveRefreshTokenForSheets } from "../db/user_google_oauth_accounts_repo.js";
import { googleUserOAuthEnvConfigured } from "./googleUserOAuthConfig.js";

export function scopeIncludesCalendar(scope: string | null | undefined): boolean {
  if (!scope || typeof scope !== "string") return false;
  return /calendar/.test(scope);
}

/**
 * ユーザー OAuth の refresh で Calendar API クライアントを返す。
 * トークンにカレンダー権限が無い場合は null（再連携が必要）。
 */
export async function getCalendarClientForLineUser(
  db: Db,
  lineUserId: string
): Promise<{ calendar: calendar_v3.Calendar; googleSub: string; scope: string | null } | null> {
  if (!googleUserOAuthEnvConfigured()) return null;
  const resolved = await resolveRefreshTokenForSheets(db, lineUserId);
  if (!resolved) return null;

  const r = await db.query<{ scope: string | null }>(
    `SELECT scope FROM user_google_oauth_accounts WHERE line_user_id = $1 AND google_sub = $2`,
    [lineUserId, resolved.googleSub]
  );
  const scope = r.rows[0]?.scope ?? null;
  if (!scopeIncludesCalendar(scope)) {
    return null;
  }

  const env = getEnv();
  const oauth2 = new OAuth2Client(
    env.GOOGLE_OAUTH_CLIENT_ID!.trim(),
    env.GOOGLE_OAUTH_CLIENT_SECRET!.trim(),
    env.GOOGLE_OAUTH_REDIRECT_URI!.trim()
  );
  oauth2.setCredentials({ refresh_token: resolved.refreshTokenPlain });
  const calendar = google.calendar({ version: "v3", auth: oauth2 });
  return { calendar, googleSub: resolved.googleSub, scope };
}
