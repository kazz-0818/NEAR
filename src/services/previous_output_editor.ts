import OpenAI from "openai";
import { getEnv } from "../config/env.js";
import { getLogger } from "../lib/logger.js";

export type EditPreviousOutputInput = {
  targetText: string;
  instruction: string;
  recentUserMessages: string[];
};

/**
 * 直前の NEAR 出力を、ユーザーの自然文指示に従って書き換える（汎用編集）。
 * 数値・事実は変えず、表記・体裁・トーン・長さを調整する。
 */
export async function editPreviousOutput(input: EditPreviousOutputInput): Promise<string> {
  const env = getEnv();
  const log = getLogger();
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

  const ctx =
    input.recentUserMessages.length > 0
      ? `このトークで先にユーザーが送った内容（参考・省略の補完用）:\n${input.recentUserMessages.slice(-4).join("\n---\n")}\n\n`
      : "";

  try {
    const completion = await client.chat.completions.create({
      model: env.OPENAI_INTENT_MODEL,
      messages: [
        {
          role: "system",
          content:
            "あなたはAI秘書「NEAR」の編集係です。与えられた【対象テキスト】を、ユーザーの指示どおりに書き換えた結果**だけ**を出力してください。\n\n" +
            "**厳守:** 数値・事実・集計結果の意味は変えない（表記・桁区切り・通貨記号・箇条書き化・順序・見出し・トーン・長さの調整はよい）。\n" +
            "Googleスプレッドシートのメニューやセル書式の**操作手順を説明しない**（ユーザーはチャット上の文面の編集を求めている）。\n" +
            "前置きや「承知しました」は付けない。出力は完成した本文のみ。日本語。",
        },
        {
          role: "user",
          content:
            ctx +
            "【対象テキスト】\n" +
            input.targetText +
            "\n\n【今回の編集指示】\n" +
            input.instruction,
        },
      ],
      max_tokens: 2400,
      temperature: 0.25,
    });
    const out = completion.choices[0]?.message?.content?.trim();
    if (out) return out;
  } catch (e) {
    log.warn({ err: e }, "editPreviousOutput failed");
  }
  throw new Error("editPreviousOutput: empty or failed");
}
