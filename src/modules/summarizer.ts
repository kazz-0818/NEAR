import OpenAI from "openai";
import { getEnv } from "../config/env.js";
import { getLogger } from "../lib/logger.js";
import type { ModuleContext, ModuleResult } from "./types.js";

function pickText(ctx: ModuleContext): string {
  const p = ctx.intent.required_params as Record<string, unknown>;
  const t = p.text;
  if (typeof t === "string" && t.trim()) return t.trim();
  return ctx.originalText.trim();
}

export async function summarizer(ctx: ModuleContext): Promise<ModuleResult> {
  const env = getEnv();
  const log = getLogger();
  const text = pickText(ctx);
  if (text.length < 8) {
    return {
      success: true,
      draft: "要約したい文章をもう少し長めにお送りください。",
      situation: "followup",
    };
  }

  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  try {
    const completion = await client.chat.completions.create({
      model: env.OPENAI_INTENT_MODEL,
      messages: [
        {
          role: "system",
          content:
            "次の文章を日本語で簡潔に要約してください。箇条書き3点以内＋1文のまとめ、トーンはフォーマルに。",
        },
        { role: "user", content: text },
      ],
      max_tokens: 400,
      temperature: 0.3,
    });
    const out = completion.choices[0]?.message?.content?.trim();
    if (out) {
      return { success: true, draft: `要点を整理しました。\n\n${out}`, situation: "success" };
    }
  } catch (e) {
    log.warn({ err: e }, "summarizer failed");
  }
  return {
    success: false,
    draft: "要約の処理中に問題が発生しました。しばらくしてからもう一度お試しください。",
    situation: "error",
  };
}
