import OpenAI from "openai";
import { getEnv } from "../config/env.js";
import { getLogger } from "../lib/logger.js";

export type ClarificationInput = {
  userMessage: string;
  recentUserMessages: string[];
  recentAssistantMessages: string[];
};

/**
 * 不足情報を整理し、秘書として自然な確認を 1 通にまとめる。
 */
export async function buildSecretaryClarificationReply(input: ClarificationInput): Promise<string> {
  const env = getEnv();
  const log = getLogger();
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

  const u = input.recentUserMessages.slice(-6).join("\n---\n");
  const a = input.recentAssistantMessages.slice(-3).join("\n---\n");

  try {
    const completion = await client.chat.completions.create({
      model: env.OPENAI_INTENT_MODEL,
      messages: [
        {
          role: "system",
          content:
            "あなたはAI秘書「NEAR」です。ユーザーの依頼を進めるために**足りない情報**を、1〜2点に絞って**短く自然に**聞き返してください。\n" +
            "**例外（この場合はファイル名を細かく聞かない）:** 購入代行・管理シート・売上表など**Googleスプレッドシートを読んで答える依頼**は、サーバーが Drive 検索・Sheets 読み取りに回す。**「ファイル名を教えて」「どのブックか」で止めない**（その依頼ではこの応答モードに来ない想定だが、来たら短く観点だけ確認）。\n" +
            "断定的に推測で埋めず、確認質問に徹する。敬語は適度に。前置きは最小。",
        },
        {
          role: "user",
          content:
            `【今回のユーザー発言】\n${input.userMessage}\n\n` +
            (u ? `【直近のユーザー発言】\n${u}\n\n` : "") +
            (a ? `【直近のNEAR返答】\n${a}` : ""),
        },
      ],
      max_tokens: 400,
      temperature: 0.45,
    });
    const out = completion.choices[0]?.message?.content?.trim();
    if (out) return out;
  } catch (e) {
    log.warn({ err: e }, "buildSecretaryClarificationReply failed");
  }
  return "もう少しだけ教えてください。どの内容について、どうしたいかを一言で送ってもらえると助かります。";
}
