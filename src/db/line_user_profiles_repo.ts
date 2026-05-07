import type { Db } from "./client.js";

export type LineUserProfile = {
  lineUserId: string;
  displayName: string;
  pictureUrl: string | null;
  language: string | null;
  memo: string | null;
  lastSeenAt: Date;
};

export async function upsertLineUserProfile(
  db: Db,
  profile: { lineUserId: string; displayName: string; pictureUrl?: string | null; language?: string | null }
): Promise<void> {
  await db.query(
    `INSERT INTO line_user_profiles (line_user_id, display_name, picture_url, language, last_seen_at, updated_at)
     VALUES ($1, $2, $3, $4, now(), now())
     ON CONFLICT (line_user_id) DO UPDATE SET
       display_name  = EXCLUDED.display_name,
       picture_url   = COALESCE(EXCLUDED.picture_url, line_user_profiles.picture_url),
       language      = COALESCE(EXCLUDED.language,    line_user_profiles.language),
       last_seen_at  = now(),
       updated_at    = now()`,
    [profile.lineUserId, profile.displayName, profile.pictureUrl ?? null, profile.language ?? null]
  );
}

export async function getLineUserProfile(db: Db, lineUserId: string): Promise<LineUserProfile | null> {
  const r = await db.query<{
    line_user_id: string;
    display_name: string;
    picture_url: string | null;
    language: string | null;
    memo: string | null;
    last_seen_at: Date;
  }>(
    `SELECT line_user_id, display_name, picture_url, language, memo, last_seen_at
     FROM line_user_profiles WHERE line_user_id = $1`,
    [lineUserId]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    lineUserId: row.line_user_id,
    displayName: row.display_name,
    pictureUrl: row.picture_url,
    language: row.language,
    memo: row.memo,
    lastSeenAt: row.last_seen_at,
  };
}
