import type { Db } from "./client.js";

/** 短い肯定だけをシート確定に使う（長文の「はい」を誤爆しない） */
export function isSpreadsheetConfirmAffirmative(text: string): boolean {
  const t = text.normalize("NFKC").trim();
  if (t.length > 56) return false;
  if (
    /^はい/u.test(t) &&
    t.length <= 32 &&
    !/違う|ちがう|いいえ|別の|違います|ちがいます/i.test(t)
  ) {
    return true;
  }
  if (
    /^うん/u.test(t) &&
    t.length <= 18 &&
    !/違う|ちがう|いいえ|別/i.test(t)
  ) {
    return true;
  }
  return /^(ハイ|ひい|イエス|yes|y|ok|おk|おーけー|それで(いい|大丈夫)?|お願い(します)?|よろしく(お願いします)?|進めて|うんうん|ええ|えぇ|そのシート(で)?|合ってる|合っています|そのまま|大丈夫|それでお願い)([\s、,。！!？?…]*)?$/iu.test(
    t
  );
}

export function isSpreadsheetConfirmNegative(text: string): boolean {
  const t = text.normalize("NFKC").trim();
  if (t.length > 40) return false;
  return /^(違う|ちがう|違います|ちがいます|別|別の|別シート|違うシート|いいえ|イイエ|no)([\s、,。！!]*)?$/iu.test(
    t
  );
}

export async function savePendingSpreadsheetConfirm(
  db: Db,
  lineUserId: string,
  spreadsheetId: string,
  suggestedName: string
): Promise<void> {
  await db.query(
    `INSERT INTO user_sheet_pending_confirm (line_user_id, spreadsheet_id, suggested_name, expires_at)
     VALUES ($1, $2, $3, now() + interval '45 minutes')
     ON CONFLICT (line_user_id) DO UPDATE SET
       spreadsheet_id = EXCLUDED.spreadsheet_id,
       suggested_name = EXCLUDED.suggested_name,
       expires_at = EXCLUDED.expires_at`,
    [lineUserId, spreadsheetId, suggestedName]
  );
}

export async function getPendingSpreadsheetConfirm(
  db: Db,
  lineUserId: string
): Promise<{ spreadsheetId: string; suggestedName: string } | null> {
  const r = await db.query<{ spreadsheet_id: string; suggested_name: string }>(
    `SELECT spreadsheet_id, suggested_name FROM user_sheet_pending_confirm
     WHERE line_user_id = $1 AND expires_at > now()`,
    [lineUserId]
  );
  const row = r.rows[0];
  if (!row) return null;
  return { spreadsheetId: row.spreadsheet_id, suggestedName: row.suggested_name };
}

/** 肯定文なら保留を消して ID を返す。非肯定なら null。 */
export async function tryConsumePendingSpreadsheetConfirm(
  db: Db,
  lineUserId: string,
  text: string
): Promise<string | null> {
  if (!isSpreadsheetConfirmAffirmative(text)) return null;
  const r = await db.query<{ spreadsheet_id: string }>(
    `DELETE FROM user_sheet_pending_confirm
     WHERE line_user_id = $1 AND expires_at > now()
     RETURNING spreadsheet_id`,
    [lineUserId]
  );
  return r.rows[0]?.spreadsheet_id ?? null;
}

export async function clearPendingSpreadsheetConfirm(db: Db, lineUserId: string): Promise<void> {
  await db.query(`DELETE FROM user_sheet_pending_confirm WHERE line_user_id = $1`, [lineUserId]);
}
