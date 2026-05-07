import type { Db } from "./client.js";

export type SheetPickOption = { id: string; name: string };

/**
 * 候補選択待ち（pending あり）のとき、ユーザーが番号を指定したかを判定する。
 * 「1」「2番」「③」「No.3」「いち」「一番目」「1版」など表記ゆれを広く受け付ける。
 * pending がない状態での誤検知を防ぐため呼び出し側で hasPendingSheetPick を確認済みの前提。
 */
export function isPendingSheetPickIndexMessage(text: string): boolean {
  const t = text.normalize("NFKC").trim();
  if (t.length > 30) return false;
  return parsePendingSheetPickIndex(t) !== null;
}

/** テキストから選択番号を抽出（1〜15 の範囲）。認識できない場合は null。 */
export function parsePendingSheetPickIndex(text: string): number | null {
  const t = text.normalize("NFKC").trim();

  // ① アラビア数字（先頭優先）: 「1」「2番」「3版」「No.4」「#5」「5番目」など
  const arabic = t.match(/^(?:no\.?|No\.?|#|番号)?\s*([1-9]|1[0-5])\b/u);
  if (arabic) {
    const n = parseInt(arabic[1], 10);
    if (n >= 1 && n <= 15) return n;
  }

  // ② 丸数字: ①〜⑮
  const circledMatch = t.match(/^([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮])/u);
  if (circledMatch) {
    const circledMap: Record<string, number> = {
      "①": 1, "②": 2, "③": 3, "④": 4, "⑤": 5,
      "⑥": 6, "⑦": 7, "⑧": 8, "⑨": 9, "⑩": 10,
      "⑪": 11, "⑫": 12, "⑬": 13, "⑭": 14, "⑮": 15,
    };
    return circledMap[circledMatch[1]] ?? null;
  }

  // ③ 漢数字（一〜十五）単独発言
  const kanjiMap: Record<string, number> = {
    "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
    "六": 6, "七": 7, "八": 8, "九": 9, "十": 10,
    "十一": 11, "十二": 12, "十三": 13, "十四": 14, "十五": 15,
  };
  for (const [kanji, num] of Object.entries(kanjiMap)) {
    if (t.startsWith(kanji)) return num;
  }

  // ④ ひらがな（いち〜じゅう）単独発言
  const kanaMap: Record<string, number> = {
    "いち": 1, "に": 2, "さん": 3, "し": 4, "ご": 5,
    "ろく": 6, "なな": 7, "はち": 8, "きゅう": 9, "じゅう": 10,
  };
  for (const [kana, num] of Object.entries(kanaMap)) {
    if (t === kana || t === kana + "ばん" || t === kana + "番") return num;
  }

  return null;
}

export async function savePendingSheetPick(
  db: Db,
  lineUserId: string,
  options: SheetPickOption[],
  originalQuery?: string
): Promise<void> {
  if (options.length === 0) return;
  await db.query(
    `INSERT INTO user_sheet_pending_pick (line_user_id, options_json, original_query, expires_at)
     VALUES ($1, $2::jsonb, $3, now() + interval '45 minutes')
     ON CONFLICT (line_user_id) DO UPDATE SET
       options_json   = EXCLUDED.options_json,
       original_query = EXCLUDED.original_query,
       expires_at     = EXCLUDED.expires_at`,
    [lineUserId, JSON.stringify(options), originalQuery ?? null]
  );
}

export async function clearPendingSheetPick(db: Db, lineUserId: string): Promise<void> {
  await db.query(`DELETE FROM user_sheet_pending_pick WHERE line_user_id = $1`, [lineUserId]);
}

export type SheetPickResult = { spreadsheetId: string; originalQuery: string | null };

/**
 * pending pick がある場合に候補リストと現在のテキストを返す（LLM fallback 用）。
 * 消費はしない。
 */
export async function peekPendingSheetPick(
  db: Db,
  lineUserId: string
): Promise<{ options: SheetPickOption[]; originalQuery: string | null } | null> {
  const r = await db.query<{ options_json: unknown; original_query: string | null }>(
    `SELECT options_json, original_query FROM user_sheet_pending_pick
     WHERE line_user_id = $1 AND expires_at > now()`,
    [lineUserId]
  );
  const row = r.rows[0];
  if (!row) return null;
  const options = Array.isArray(row.options_json) ? (row.options_json as SheetPickOption[]) : [];
  return { options, originalQuery: row.original_query };
}

export async function consumePendingSheetPickByIndex(
  db: Db,
  lineUserId: string,
  idx: number
): Promise<SheetPickResult | null> {
  const peek = await peekPendingSheetPick(db, lineUserId);
  if (!peek) return null;
  const picked = peek.options[idx - 1];
  const id = picked?.id;
  if (typeof id !== "string" || id.length === 0) return null;
  await db.query(`DELETE FROM user_sheet_pending_pick WHERE line_user_id = $1`, [lineUserId]);
  return { spreadsheetId: id, originalQuery: peek.originalQuery };
}

export async function tryConsumePendingSheetPick(
  db: Db,
  lineUserId: string,
  text: string
): Promise<SheetPickResult | null> {
  const idx = parsePendingSheetPickIndex(text);
  if (idx == null || idx < 1) return null;
  return consumePendingSheetPickByIndex(db, lineUserId, idx);
}

export async function hasPendingSheetPick(db: Db, lineUserId: string): Promise<boolean> {
  const r = await db.query<{ c: string }>(
    `SELECT 1 AS c FROM user_sheet_pending_pick WHERE line_user_id = $1 AND expires_at > now()`,
    [lineUserId]
  );
  return r.rows.length > 0;
}
