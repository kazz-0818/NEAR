import OpenAI from "openai";
import { getEnv } from "../config/env.js";

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
          "ユーザーは「購入代行シート」「POPUP」「3月の売上は？」のように**ざっくり言う**ことがあります。**会話に出た名前・業務名に最も近いタブ名**を選び、一覧に完全一致する文字列を sheetTitle に入れてください（「シート」接尾辞だけ違う場合は一致する本体名を選ぶ）。",
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
          "**前置き禁止:** 表はシステムが**既に**シートから取得済み。「リンクを直接開けない」「URLを開けない」「提供されたデータから」など**アクセス不能を示す文は一切書かない**（内容と矛盾する）。いきなり依頼への回答から始める。",
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
