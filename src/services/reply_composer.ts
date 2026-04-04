import OpenAI from "openai";
import { getEnv } from "../config/env.js";
import { loadPrompt } from "../lib/promptLoader.js";
import { getLogger } from "../lib/logger.js";

let personaCache: string | null = null;

async function getPersona(): Promise<string> {
  if (personaCache) return personaCache;
  personaCache = await loadPrompt("prompts/near.persona.md");
  return personaCache;
}

export type ComposeInput = {
  /** ユーザーへの最終メッセージの骨子（モジュール出力やテンプレ） */
  draft: string;
  /** 状況: success | unsupported | error | followup */
  situation: "success" | "unsupported" | "error" | "followup";
};

export async function composeNearReply(input: ComposeInput): Promise<string> {
  const env = getEnv();
  const log = getLogger();
  const persona = await getPersona();

  try {
    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: env.OPENAI_INTENT_MODEL,
      messages: [
        { role: "system", content: persona },
        {
          role: "user",
          content: [
            `状況: ${input.situation}`,
            "次のドラフトを、NEARの口調に整えて1通の返信にしてください。意味は変えないでください。",
            "",
            input.draft,
          ].join("\n"),
        },
      ],
      max_tokens: 400,
      temperature: 0.5,
    });
    const text = completion.choices[0]?.message?.content?.trim();
    if (text) return text;
  } catch (e) {
    log.warn({ err: e }, "composeNearReply failed, using draft");
  }
  return input.draft;
}
