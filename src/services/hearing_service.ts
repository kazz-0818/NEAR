import OpenAI from "openai";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { getEnv } from "../config/env.js";
import { getLogger } from "../lib/logger.js";

export type HearingQuestion = { key: string; text: string };

type SuggestionRow = {
  summary: string;
  required_apis: unknown;
  suggested_modules: unknown;
  improvement_kind: string | null;
  risk_level: string | null;
};

export type SuggestionHearingSeedRow = SuggestionRow & {
  original_message: string;
  steps: unknown;
};

const hearingFromLlmSchema = z.object({
  questions: z
    .array(
      z.object({
        key: z.string().regex(/^[a-z][a-z0-9_]{0,48}$/),
        text: z.string().min(8).max(1200),
      })
    )
    .min(4)
    .max(10),
});

const HEARING_QUESTIONS_LLM_SCHEMA = {
  name: "near_hearing_questions",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      questions: {
        type: "array",
        minItems: 4,
        maxItems: 10,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            key: { type: "string", pattern: "^[a-z][a-z0-9_]{0,48}$" },
            text: { type: "string", minLength: 8, maxLength: 1200 },
          },
          required: ["key", "text"],
        },
      },
    },
    required: ["questions"],
  },
} as const;

const batchAnswersSchema = z.object({
  answers: z.array(
    z.object({
      key: z.string(),
      answer: z.string(),
    })
  ),
});

const BATCH_HEARING_ANSWERS_SCHEMA = {
  name: "near_batch_hearing_answers",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      answers: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            key: { type: "string" },
            answer: { type: "string" },
          },
          required: ["key", "answer"],
        },
      },
    },
    required: ["answers"],
  },
} as const;

/** ルールベースでヒアリング項目を組み立て（LLM 失敗時のフォールバック） */
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

/** 依頼内容に即したヒアリング設問を LLM で生成。失敗時はルールベースへフォールバック */
export async function generateContextualHearingQuestions(
  row: SuggestionHearingSeedRow
): Promise<HearingQuestion[]> {
  const env = getEnv();
  const log = getLogger();
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

  const payload = {
    user_original_request: row.original_message.slice(0, 2000),
    implementation_summary: row.summary.slice(0, 2000),
    required_apis: row.required_apis,
    suggested_modules: row.suggested_modules,
    implementation_steps: row.steps,
    improvement_kind: row.improvement_kind,
    risk_level: row.risk_level,
  };

  try {
    const completion = await client.chat.completions.create({
      model: env.OPENAI_SUGGESTION_MODEL,
      messages: [
        {
          role: "system",
          content:
            "あなたはプロダクトの要件ヒアリング担当です。NEAR（LINE秘書）の新機能候補について、**この依頼と提案内容に特化した**質問だけを出してください。\n" +
            "汎用テンプレの羅列は避け、**足りない実装情報**（データの所在、権限、失敗時、境界条件、用語の定義など）を具体的に聞いてください。\n" +
            "質問は **5〜8 個**。各 `text` は1つの段落で、ユーザーがLINEで答えやすい日本語にしてください。\n" +
            "`key` は重複のない snake_case（英小文字で始まる）にしてください。",
        },
        { role: "user", content: JSON.stringify(payload, null, 2) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: HEARING_QUESTIONS_LLM_SCHEMA,
      },
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("empty completion");
    const parsed = hearingFromLlmSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) throw new Error("schema mismatch");
    const seen = new Set<string>();
    const out: HearingQuestion[] = [];
    for (const q of parsed.data.questions) {
      if (seen.has(q.key)) continue;
      seen.add(q.key);
      out.push({ key: q.key, text: q.text.trim() });
    }
    if (out.length >= 4) return out;
  } catch (e) {
    log.warn({ err: e }, "generateContextualHearingQuestions failed; using rule-based");
  }

  return buildHearingQuestions(row);
}

/** 一括ヒアリング用の本文（番号付き） */
export function formatBatchHearingLineMessage(input: {
  questions: HearingQuestion[];
  suggestionId: number;
}): string {
  const lines: string[] = [
    "成長候補として進めるにあたり、次の点をまとめて教えてください。",
    "【1通のメッセージで】番号ごとに答えても構いませんし、箇条書き・自由形式でも構いません。",
    "",
  ];
  for (let i = 0; i < input.questions.length; i++) {
    const q = input.questions[i]!;
    lines.push(`【${i + 1}】（${q.key}）`);
    lines.push(q.text);
    lines.push("");
  }
  lines.push(`（候補 #${input.suggestionId}）`);
  lines.push("ヒアリングをやめる場合は「ヒアリングキャンセル」と送ってください。");
  return lines.join("\n");
}

/** 1通の返信から各設問への回答を抽出 */
export async function parseBatchHearingAnswers(input: {
  questionBlocks: { key: string; text: string }[];
  userReply: string;
}): Promise<Record<string, string>> {
  const env = getEnv();
  const log = getLogger();
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

  const qList = input.questionBlocks
    .map((q, i) => `【${i + 1}. key=${q.key}】\n${q.text}`)
    .join("\n\n---\n\n");

  try {
    const completion = await client.chat.completions.create({
      model: env.OPENAI_INTENT_MODEL,
      messages: [
        {
          role: "system",
          content:
            "ユーザーの返信テキストから、各質問 key に対応する回答を抽出して JSON で返す。\n" +
            "番号付きで答えていれば対応づける。曖昧なら推測で埋め、無ければ「（返信なし）」。\n" +
            "すべての key について1件ずつ answers に含めること。",
        },
        {
          role: "user",
          content: `質問一覧:\n${qList}\n\n---\n\nユーザー返信:\n${input.userReply.slice(0, 8000)}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: BATCH_HEARING_ANSWERS_SCHEMA,
      },
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("empty");
    const parsed = batchAnswersSchema.parse(JSON.parse(raw));
    const out: Record<string, string> = {};
    const keys = new Set(input.questionBlocks.map((q) => q.key));
    for (const row of parsed.answers) {
      if (keys.has(row.key)) out[row.key] = row.answer.trim() || "（返信なし）";
    }
    for (const k of keys) {
      if (out[k] == null) out[k] = "（返信なし）";
    }
    return out;
  } catch (e) {
    log.warn({ err: e }, "parseBatchHearingAnswers failed; storing whole reply on first key");
    const first = input.questionBlocks[0]?.key;
    const out: Record<string, string> = {};
    if (first) {
      out[first] = input.userReply.trim().slice(0, 4000);
      for (let i = 1; i < input.questionBlocks.length; i++) {
        out[input.questionBlocks[i]!.key] = "（自動分割できず要確認）";
      }
    }
    return out;
  }
}

export async function seedHearingItems(
  db: Db,
  suggestionId: number,
  row: SuggestionHearingSeedRow
): Promise<number> {
  const questions = await generateContextualHearingQuestions(row);
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

export async function listHearingQuestionBlocks(
  db: Db,
  suggestionId: number
): Promise<{ key: string; text: string }[]> {
  const r = await db.query<{ question_key: string; question_text: string }>(
    `SELECT question_key, question_text FROM growth_hearing_items
     WHERE implementation_suggestion_id = $1
     ORDER BY sort_order ASC`,
    [suggestionId]
  );
  return r.rows.map((row) => ({ key: row.question_key, text: row.question_text }));
}

export async function applyHearingAnswersByKey(
  db: Db,
  suggestionId: number,
  answers: Record<string, string>
): Promise<void> {
  for (const [key, text] of Object.entries(answers)) {
    await db.query(
      `UPDATE growth_hearing_items
       SET answer_text = $1, answered_at = now()
       WHERE implementation_suggestion_id = $2 AND question_key = $3`,
      [text, suggestionId, key]
    );
  }
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
