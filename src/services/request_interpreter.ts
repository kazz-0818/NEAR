import OpenAI from "openai";
import { getEnv } from "../config/env.js";
import { loadPrompt } from "../lib/promptLoader.js";
import { getLogger } from "../lib/logger.js";
import {
  type RequestInterpretation,
  requestInterpretationSchema,
} from "../models/requestInterpretation.js";

let systemPromptCache: string | null = null;

async function getSystemPrompt(): Promise<string> {
  if (systemPromptCache) return systemPromptCache;
  systemPromptCache = await loadPrompt("prompts/request_interpreter.system.md");
  return systemPromptCache;
}

function truncate(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export type InterpretSecretaryRequestInput = {
  userText: string;
  recentUserMessages: string[];
  recentAssistantMessages: string[];
};

/**
 * 会話文脈から request_mode を推定する。assistant 履歴が無いときは LLM を呼ばず new_request。
 */
export async function interpretSecretaryRequest(
  input: InterpretSecretaryRequestInput
): Promise<RequestInterpretation> {
  const env = getEnv();
  if (env.NEAR_SECRETARY_LAYER_DISABLED) {
    return { mode: "new_request", confidence: 1, reasoning: "secretary_layer_disabled" };
  }

  const assistantNonEmpty = input.recentAssistantMessages.some((s) => s.trim().length > 0);
  if (!assistantNonEmpty) {
    return { mode: "new_request", confidence: 1, reasoning: "no_assistant_history" };
  }

  const log = getLogger();
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const system = await getSystemPrompt();

  const userBlock = truncate(input.userText, 4000);
  const prevUser = input.recentUserMessages
    .filter((s) => s.trim())
    .slice(-8)
    .map((s, i) => `${i + 1}. ${truncate(s, 1200)}`)
    .join("\n");
  const prevAsst = input.recentAssistantMessages
    .filter((s) => s.trim())
    .slice(-3)
    .map((s, i) => `${i + 1}. ${truncate(s, 8000)}`)
    .join("\n\n---\n\n");

  const userContent =
    `【今回のユーザー発言】\n${userBlock}\n\n` +
    (prevUser ? `【このトークで先のユーザー発言（古い順・抜粋）】\n${prevUser}\n\n` : "") +
    `【NEAR の直近の返答（古い順・編集対象になりうる）】\n${prevAsst || "(なし)"}\n\n` +
    "上記だけを根拠に JSON を1つ返す。";

  try {
    const completion = await client.chat.completions.create({
      model: env.OPENAI_INTENT_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
      max_tokens: 220,
      temperature: 0.2,
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("empty interpreter completion");
    const json = JSON.parse(raw) as unknown;
    const parsed = requestInterpretationSchema.safeParse(json);
    if (parsed.success) return parsed.data;
    log.warn({ json }, "request interpreter schema mismatch");
  } catch (e) {
    log.warn({ err: e }, "interpretSecretaryRequest failed");
  }

  return { mode: "new_request", confidence: 0.5, reasoning: "interpreter_fallback" };
}
