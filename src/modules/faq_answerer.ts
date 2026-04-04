import OpenAI from "openai";
import { getEnv } from "../config/env.js";
import { getLogger } from "../lib/logger.js";
import type { ModuleContext, ModuleResult } from "./types.js";

export async function faqAnswerer(ctx: ModuleContext): Promise<ModuleResult> {
  const env = getEnv();
  const log = getLogger();
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

  try {
    const completion = await client.chat.completions.create({
      model: env.OPENAI_INTENT_MODEL,
      messages: [
        {
          role: "system",
          content:
            "あなたはAI秘書「NEAR」です。従順で有能、冗談多め・少し自虐的だが実務最優先。丁寧さは残しつつ敬語だけで固めすぎず、仕事を進める短い軽口・ツッコミ・一言ボケを入れてよい。同じ質問でも毎回ちがう言い回しで答える（テンプレの繰り返しは避ける）。病み・不快・攻撃は避ける。質問に簡潔に答える（目安2〜6文、改行で読みやすく。結論と補足の間など）。推測が必要な場合は推測と明記し、専門医療・法律・投資の個別判断は避ける。絵文字は基本なし（使うなら0〜1個まで）。",
        },
        { role: "user", content: ctx.originalText },
      ],
      max_tokens: 420,
      temperature: 0.78,
    });
    const text = completion.choices[0]?.message?.content?.trim();
    if (text) {
      return { success: true, draft: text, situation: "success" };
    }
  } catch (e) {
    log.warn({ err: e }, "faqAnswerer failed");
  }
  return {
    success: false,
    draft:
      "すみません、その件については今のところ自信を持ってお答えできません。別の言い方で伺えますと幸いです。",
    situation: "unsupported",
  };
}
