import type { Db } from "./client.js";

export type SheetPickOption = { id: string; name: string };

/** 「1」「2番」など候補番号だけの短文 */
export function isPendingSheetPickIndexMessage(text: string): boolean {
  const t = text.normalize("NFKC").trim();
  if (t.length > 14) return false;
  return /^\s*([1-9]|1[0-5])\s*(番)?\s*$/u.test(t);
}

export function parsePendingSheetPickIndex(text: string): number | null {
  const t = text.normalize("NFKC").trim();
  const m = t.match(/^\s*([1-9]|1[0-5])\b/u);
  if (!m) return null;
  return parseInt(m[1], 10);
}

export async function savePendingSheetPick(db: Db, lineUserId: string, options: SheetPickOption[]): Promise<void> {
  if (options.length === 0) return;
  await db.query(
    `INSERT INTO user_sheet_pending_pick (line_user_id, options_json, expires_at)
     VALUES ($1, $2::jsonb, now() + interval '45 minutes')
     ON CONFLICT (line_user_id) DO UPDATE SET
       options_json = EXCLUDED.options_json,
       expires_at = EXCLUDED.expires_at`,
    [lineUserId, JSON.stringify(options)]
  );
}

export async function clearPendingSheetPick(db: Db, lineUserId: string): Promise<void> {
  await db.query(`DELETE FROM user_sheet_pending_pick WHERE line_user_id = $1`, [lineUserId]);
}

export async function tryConsumePendingSheetPick(
  db: Db,
  lineUserId: string,
  text: string
): Promise<string | null> {
  if (!isPendingSheetPickIndexMessage(text)) return null;
  const idx = parsePendingSheetPickIndex(text);
  if (idx == null || idx < 1) return null;

  const r = await db.query<{ options_json: unknown }>(
    `SELECT options_json FROM user_sheet_pending_pick
     WHERE line_user_id = $1 AND expires_at > now()`,
    [lineUserId]
  );
  const raw = r.rows[0]?.options_json;
  const options = Array.isArray(raw) ? (raw as SheetPickOption[]) : [];
  const picked = options[idx - 1];
  const id = picked?.id;
  if (typeof id !== "string" || id.length === 0) return null;

  await db.query(`DELETE FROM user_sheet_pending_pick WHERE line_user_id = $1`, [lineUserId]);
  return id;
}

export async function hasPendingSheetPick(db: Db, lineUserId: string): Promise<boolean> {
  const r = await db.query<{ c: string }>(
    `SELECT 1 AS c FROM user_sheet_pending_pick WHERE line_user_id = $1 AND expires_at > now()`,
    [lineUserId]
  );
  return r.rows.length > 0;
}
