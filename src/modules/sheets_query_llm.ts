import OpenAI from "openai";
import { getEnv } from "../config/env.js";
import { getLogger } from "../lib/logger.js";

const DRIVE_SHEET_KEYWORDS_SCHEMA = {
  name: "near_drive_sheet_keywords",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      keywords: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: 14,
      },
    },
    required: ["keywords"],
  },
} as const;

/**
 * 曖昧な依頼から、Google Drive のファイル名検索（name contains）に使う部分文字列を LLM で推定する。
 * 特定業務に固定しない（購入代行などに偏らせない）。
 */
export async function inferDriveSheetSearchKeywordsFromLlm(userMessage: string): Promise<string[]> {
  const env = getEnv();
  const log = getLogger();
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const msg = userMessage.normalize("NFKC").trim().slice(0, 4000);
  if (!msg) return [];

  try {
    const completion = await client.chat.completions.create({
      model: env.OPENAI_INTENT_MODEL,
      messages: [
        {
          role: "system",
          content:
            "ユーザーは Google ドライブ上のスプレッドシートの**ファイル名**を、曖昧・口語で言うことが多い。\n" +
            "あなたの仕事は、Drive API の `name contains` に渡す**検索用の部分文字列**を **1〜14 個**返すことだけです。\n\n" +
            "**ルール**\n" +
            "- **どんな業務・プロジェクトでも**よい。特定の業種（例: 購入代行だけ）に**思考を縛らない**。発話から読み取れる固有名・略称・英字・カタカナ・記号まわりの語を優先。\n" +
            "- 各キーワードは **2〜40 文字**程度。`教えて` `見て` `ください` `シート` 単体のような**検索特徴が弱い語だけ**は避ける（ただし「POPUPシート」のように固有名として意味があれば可）。\n" +
            "- ユーザーが「あの表」「昨日のやつ」のように**極端に情報が少ない**ときは、**会話に出ている他の手がかり**が無い限り、無理に多く作らず **推測しうる語 1〜3 個**にとどめる（存在するファイル名をでっち上げない。検索候補のみ）。\n" +
            "- **JSON の keywords 配列だけ**をスキーマに従って返す。",
        },
        { role: "user", content: `次の発言から、Drive ファイル名検索用キーワードを出してください。\n\n${msg}` },
      ],
      response_format: { type: "json_schema", json_schema: DRIVE_SHEET_KEYWORDS_SCHEMA },
      max_tokens: 350,
      temperature: 0.35,
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) return [];
    const j = JSON.parse(raw) as { keywords?: unknown };
    if (!Array.isArray(j.keywords)) return [];
    const out: string[] = [];
    for (const x of j.keywords) {
      if (typeof x !== "string") continue;
      const t = x.normalize("NFKC").trim();
      if (t.length >= 2 && t.length <= 80) out.push(t);
    }
    return out;
  } catch (e) {
    log.warn({ err: e }, "inferDriveSheetSearchKeywordsFromLlm failed");
    return [];
  }
}

const PICK_SHEET_SCHEMA = {
  name: "near_sheet_pick",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      sheetTitle: { type: "string" },
      reasoning: { type: "string" },
    },
    required: ["sheetTitle", "reasoning"],
  },
} as const;

export async function pickSheetWithLlm(userQuestion: string, sheetTitles: string[]): Promise<string> {
  const env = getEnv();
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const list = sheetTitles.map((t, i) => `${i + 1}. ${t}`).join("\n");
  const completion = await client.chat.completions.create({
    model: env.OPENAI_INTENT_MODEL,
    messages: [
      {
        role: "system",
        content:
          "あなたはスプレッドシートのシート名選択器です。ユーザーの質問に答えるのに最も適切な1つのシート名を、次の一覧から選びます。\n" +
          "ユーザーは業務名・プロジェクト名を**ざっくり言う**ことがあります（例: 略称、通称、月や指標だけ）。**会話に出た名前に最も近いタブ名**を選び、一覧に完全一致する文字列を sheetTitle に入れてください（「シート」接尾辞だけ違う場合は一致する本体名を選ぶ）。",
      },
      {
        role: "user",
        content: `質問:\n${userQuestion}\n\nシート一覧:\n${list}`,
      },
    ],
    response_format: { type: "json_schema", json_schema: PICK_SHEET_SCHEMA },
    max_tokens: 200,
    temperature: 0.2,
  });
  const raw = completion.choices[0]?.message?.content;
  if (!raw) return sheetTitles[0] ?? "";
  const j = JSON.parse(raw) as { sheetTitle?: string };
  return typeof j.sheetTitle === "string" ? j.sheetTitle : sheetTitles[0] ?? "";
}

export async function answerSheetQuestionWithLlm(
  userQuestion: string,
  sheetTitle: string,
  tsv: string
): Promise<string> {
  const env = getEnv();
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const completion = await client.chat.completions.create({
    model: env.OPENAI_INTENT_MODEL,
    messages: [
      {
        role: "system",
        content:
          "あなたはAI秘書「NEAR」です。与えられた表データ（タブ区切り・1行目が見出しのことが多い）**だけ**を根拠に答えてください。\n\n" +
          "**最優先: ユーザーの指示に合わせて提示する（臨機応変）**\n" +
          "- 質問に**形式・長さ・切り口**の希望があれば、それに最優先で従う（例: 「一覧だけ」「箇条書き」「結論だけ」「詳しく」「報告書調」「短文で」「表っぽく」「ワンポイント」「比較して」「ランキング」「日別に」など）。\n" +
          "- 指定が無いときは読みやすさ優先。集計・件数が主目的なら、見出し＋・行の一覧でもよいが、**決まったテンプレに縛らない**。\n" +
          "- ユーザーが**締め・所感・雑談を不要**と言っていれば付けない。必要なら最後に**短い1文** NEAR らしく（従順＋軽口）。サービス定型の長いお礼は使わない。\n\n" +
          "**内容:** 丸写しや列の機械羅列**だけ**で終わらせない。依頼に応じて (1)集計・算出 (2)条件・期間での抽出 (3)比較・傾向・所感 を必要な分だけ含める。「一覧だけ」と明示されていても、最低限の見出しや区切りで読みやすくしてよい。見出し行から列を推定し、日付表記のゆれに注意。データに無いことは書かない。\n\n" +
          "日本語で。数値・結論は落とさない。\n\n" +
          "**前置き禁止:** 表はシステムが**既に**シートから取得済み。「リンクを直接開けない」「URLを開けない」「提供されたデータから」など**アクセス不能を示す文は一切書かない**（内容と矛盾する）。いきなり依頼への回答から始める。\n" +
          "**表記の指示:** 質問が「円マーク」「￥」「カンマ」「桁区切り」など**見せ方だけ**のときも、集計結果の意味は変えず**指定の表記**で出力する（スプレッドシートのメニュー操作説明は書かない）。",
      },
      {
        role: "user",
        content: `シート名: ${sheetTitle}\n\n質問:\n${userQuestion}\n\n表データ:\n${tsv}`,
      },
    ],
    max_tokens: 1200,
    temperature: 0.35,
  });
  return completion.choices[0]?.message?.content?.trim() ?? "すみません、回答を組み立てられませんでした。";
}
