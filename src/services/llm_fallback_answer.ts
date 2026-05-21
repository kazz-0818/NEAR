import OpenAI from "openai";
import { getEnv } from "../config/env.js";
import { getLogger } from "../lib/logger.js";
import { loadPrompt } from "../lib/promptLoader.js";

const LLM_FALLBACK_RULES =
  "【経路】定型モジュールに当たらなかった依頼を、NEARとしてその場で処理します。\n" +
  "- 実務寄り・端的に。メタ説明（「通常のAI回答で〜」など）は書かず、そのまま内容に答える。\n" +
  "- 丁寧に。できることは具体的に。すぐ「開発しますか？」に寄せすぎない。機能化の示唆は必要なときだけ一言。\n" +
  "- 永続機能・LINE配信・DB・定期実行・外部APIの新規実装が要る話題は断定せず、短く限界を述べる。\n" +
  "- リアルタイムの天気・株価・ニュース等が必要な質問は、この応答では数値を断定しない。\n";

export async function runLlmFallbackAnswer(input: {
  userText: string;
  recentUserMessages?: string[];
  recentAssistantMessages?: string[];
  userMemoryBlock?: string;
}): Promise<{ draft: string }> {
  const env = getEnv();
  const log = getLogger();
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

  const [persona, constraints] = await Promise.all([
    loadPrompt("prompts/near.persona.md"),
    loadPrompt("prompts/near.faq_constraints.md"),
  ]);

  const chunks: string[] = [];
  if (input.userMemoryBlock?.trim()) {
    chunks.push(input.userMemoryBlock.trim(), "");
  }
  const prev = input.recentUserMessages?.filter((s) => s.trim().length > 0) ?? [];
  const asst = input.recentAssistantMessages?.filter((s) => s.trim().length > 0) ?? [];
  if (prev.length > 0) {
    chunks.push("【参考：これまでのユーザー発言（古い順）】", ...prev.map((m, i) => `${i + 1}. ${m}`), "");
  }
  if (asst.length > 0) {
    chunks.push("【参考：NEARの直近返答（古い順）】", ...asst.map((m, i) => `${i + 1}. ${m}`), "");
  }
  chunks.push("【今回の発言】", input.userText);

  try {
    const completion = await client.chat.completions.create({
      model: env.OPENAI_INTENT_MODEL,
      messages: [
        { role: "system", content: persona },
        { role: "system", content: constraints },
        { role: "system", content: LLM_FALLBACK_RULES },
        { role: "user", content: chunks.join("\n") },
      ],
      max_tokens: 720,
      temperature: 0.55,
      frequency_penalty: 0.35,
      presence_penalty: 0.2,
    });
    const draft = completion.choices[0]?.message?.content?.trim();
    if (draft) return { draft };
  } catch (e) {
    log.warn({ err: e }, "runLlmFallbackAnswer failed");
  }
  throw new Error("llm_fallback_empty");
}
