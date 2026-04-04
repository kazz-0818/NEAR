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
            "あなたは秘書NEARです。ユーザーの質問に、簡潔に1〜4文で答えてください。推測が必要な場合は推測と明記し、専門医療・法律・投資の個別判断は避けてください。",
        },
        { role: "user", content: ctx.originalText },
      ],
      max_tokens: 350,
      temperature: 0.4,
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
