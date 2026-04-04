import type { Db } from "../db/client.js";

export type HearingQuestion = { key: string; text: string };

type SuggestionRow = {
  summary: string;
  required_apis: unknown;
  suggested_modules: unknown;
  improvement_kind: string | null;
  risk_level: string | null;
};

/** ルールベースでヒアリング項目を組み立て（1問ずつ出す） */
export function buildHearingQuestions(row: SuggestionRow): HearingQuestion[] {
  const apis: string[] = Array.isArray(row.required_apis)
    ? (row.required_apis as string[])
    : typeof row.required_apis === "string"
      ? []
      : [];

  const qs: HearingQuestion[] = [];

  qs.push({
    key: "goal_confirm",
    text: `この成長で実現したいことは、次の理解で合っていますか？\n「${row.summary.slice(0, 280)}${row.summary.length > 280 ? "…" : ""}」\n違う場合は、正しいゴールを短く教えてください。合っていれば「はい」とだけ返信ください。`,
  });

  if (apis.length > 0) {
    qs.push({
      key: "external_services",
      text: `想定している外部サービスや API は次のとおりです：\n${apis.map((a) => `・${a}`).join("\n")}\n他に連携したいものはありますか？ また、認証情報（APIキーや OAuth）はすでに用意できますか？`,
    });
  } else {
    qs.push({
      key: "external_services",
      text: "この機能で使う外部サービス（Google、Notion、スプレッドシートなど）はありますか？ なければ「なし」と返信ください。",
    });
  }

  qs.push({
    key: "user_scope",
    text: "対象となるのは、どの LINE 利用者ですか？（全員／ご本人のみ／特定のグループ など、分かる範囲で）",
  });

  qs.push({
    key: "runtime_conditions",
    text: "実行のタイミングや条件はありますか？（例: メッセージを受けたら即時、毎朝9時、特定のキーワードのとき）",
  });

  qs.push({
    key: "storage_and_templates",
    text: "保存先（DB・スプレッドシートなど）や、使いたい文面テンプレートがあれば教えてください。特になければ「なし」で構いません。",
  });

  if (row.improvement_kind === "external_auth" || row.risk_level === "high") {
    qs.push({
      key: "security_notes",
      text: "セキュリティ上の制約（扱ってはいけないデータ、マスキングしたい項目）はありますか？",
    });
  }

  return qs;
}

export async function seedHearingItems(db: Db, suggestionId: number, row: SuggestionRow): Promise<number> {
  const questions = buildHearingQuestions(row);
  let n = 0;
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]!;
    await db.query(
      `INSERT INTO growth_hearing_items (
         implementation_suggestion_id, sort_order, question_key, question_text
       ) VALUES ($1, $2, $3, $4)
       ON CONFLICT (implementation_suggestion_id, question_key) DO NOTHING`,
      [suggestionId, i * 10, q.key, q.text]
    );
    n++;
  }
  return n;
}

export async function getNextUnansweredHearing(db: Db, suggestionId: number): Promise<{
  id: number;
  question_key: string;
  question_text: string;
} | null> {
  const r = await db.query<{ id: string; question_key: string; question_text: string }>(
    `SELECT id, question_key, question_text
     FROM growth_hearing_items
     WHERE implementation_suggestion_id = $1 AND answer_text IS NULL
     ORDER BY sort_order ASC
     LIMIT 1`,
    [suggestionId]
  );
  const row = r.rows[0];
  if (!row) return null;
  return { id: Number(row.id), question_key: row.question_key, question_text: row.question_text };
}

export async function saveHearingAnswer(
  db: Db,
  itemId: number,
  answerText: string
): Promise<void> {
  await db.query(
    `UPDATE growth_hearing_items
     SET answer_text = $1, answered_at = now()
     WHERE id = $2`,
    [answerText.trim(), itemId]
  );
}

export async function hearingAnswersAsJson(db: Db, suggestionId: number): Promise<Record<string, string>> {
  const r = await db.query<{ question_key: string; answer_text: string | null }>(
    `SELECT question_key, answer_text FROM growth_hearing_items
     WHERE implementation_suggestion_id = $1 AND answer_text IS NOT NULL
     ORDER BY sort_order`,
    [suggestionId]
  );
  const out: Record<string, string> = {};
  for (const row of r.rows) {
    if (row.answer_text) out[row.question_key] = row.answer_text;
  }
  return out;
}

export async function mergeRequiredInformation(
  db: Db,
  suggestionId: number,
  answers: Record<string, string>
): Promise<void> {
  await db.query(
    `UPDATE implementation_suggestions
     SET required_information = required_information || $1::jsonb,
         updated_at = now()
     WHERE id = $2`,
    [JSON.stringify(answers), suggestionId]
  );
}
