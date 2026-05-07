import type { Db } from "./client.js";

export async function loadUserSpreadsheetDefault(db: Db, lineUserId: string): Promise<string | null> {
  try {
    const r = await db.query<{ spreadsheet_id: string | null }>(
      `SELECT spreadsheet_id FROM user_sheet_defaults WHERE line_user_id = $1`,
      [lineUserId]
    );
    return r.rows[0]?.spreadsheet_id ?? null;
  } catch {
    return null;
  }
}

export async function saveUserSpreadsheetDefault(
  db: Db,
  lineUserId: string,
  spreadsheetId: string
): Promise<void> {
  await db.query(
    `INSERT INTO user_sheet_defaults (line_user_id, spreadsheet_id, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (line_user_id) DO UPDATE SET
       spreadsheet_id = EXCLUDED.spreadsheet_id,
       updated_at = now()`,
    [lineUserId, spreadsheetId]
  );
}

/** 直近でクエリしたスプレッドシートIDを記録する */
export async function saveLastQueriedSpreadsheet(
  db: Db,
  lineUserId: string,
  spreadsheetId: string
): Promise<void> {
  await db.query(
    `INSERT INTO user_sheet_defaults (line_user_id, spreadsheet_id, last_queried_spreadsheet_id, last_queried_at, updated_at)
     VALUES ($1, NULL, $2, now(), now())
     ON CONFLICT (line_user_id) DO UPDATE SET
       last_queried_spreadsheet_id = EXCLUDED.last_queried_spreadsheet_id,
       last_queried_at = EXCLUDED.last_queried_at,
       updated_at = now()`,
    [lineUserId, spreadsheetId]
  );
}

/** 直近クエリで使ったスプレッドシートIDを返す（なければ null） */
export async function loadLastQueriedSpreadsheet(db: Db, lineUserId: string): Promise<string | null> {
  try {
    const r = await db.query<{ last_queried_spreadsheet_id: string | null }>(
      `SELECT last_queried_spreadsheet_id FROM user_sheet_defaults WHERE line_user_id = $1`,
      [lineUserId]
    );
    return r.rows[0]?.last_queried_spreadsheet_id ?? null;
  } catch {
    return null;
  }
}
