import OpenAI from "openai";
import type { Db } from "../db/client.js";
import { getEnv } from "../config/env.js";
import { getLogger } from "../lib/logger.js";
import { loadPrompt } from "../lib/promptLoader.js";
import { semanticOperationSchema, type SemanticOperation } from "../models/operation.js";

let promptCache: string | null = null;

async function getSystemPrompt(): Promise<string> {
  if (promptCache) return promptCache;
  promptCache = await loadPrompt("prompts/semantic-operation-router.md");
  return promptCache;
}

export async function resolveSemanticOperation(
  input: {
    db: Db;
    userText: string;
    recentUserMessages: string[];
    recentAssistantMessages: string[];
    actorDisplayName?: string;
  },
  deps?: {
    callModel?: (args: {
      model: string;
      system: string;
      userContent: string;
    }) => Promise<string>;
  }
): Promise<SemanticOperation> {
  const env = getEnv();
  const log = getLogger();

  const fallback: SemanticOperation = {
    kind: "unknown",
    confidence: 0,
    extracted_text: null,
    when_description: null,
    target_number: null,
    target_label: null,
    needs_confirmation: false,
    danger_level: "none",
    reason: "semantic_router_fallback",
    route_hint: "clarify",
  };

  const recentUser = input.recentUserMessages
    .filter((s) => s.trim())
    .slice(-8)
    .map((s, i) => `${i + 1}. ${s}`)
    .join("\n");
  const recentAssistant = input.recentAssistantMessages
    .filter((s) => s.trim())
    .slice(-6)
    .map((s, i) => `${i + 1}. ${s}`)
    .join("\n\n---\n\n");
  const userContent =
    `【今回のユーザー発言】\n${input.userText.trim()}\n\n` +
    (input.actorDisplayName ? `【発言者名】\n${input.actorDisplayName}\n\n` : "") +
    (recentUser ? `【直近ユーザー発言（古い順）】\n${recentUser}\n\n` : "") +
    (recentAssistant ? `【直近NEAR返答（古い順）】\n${recentAssistant}\n\n` : "") +
    "上記をもとに JSON を1つだけ返してください。";

  try {
    const model = env.SEMANTIC_ROUTER_MODEL?.trim() || env.OPENAI_INTENT_MODEL;
    const system = await getSystemPrompt();
    const raw = deps?.callModel
      ? await deps.callModel({ model, system, userContent })
      : await (async () => {
          const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
          const completion = await client.chat.completions.create({
            model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: userContent },
            ],
            response_format: { type: "json_object" },
            temperature: 0.1,
            max_tokens: 300,
          });
          return completion.choices[0]?.message?.content ?? "";
        })();

    const parsed = semanticOperationSchema.parse(JSON.parse(raw));
    return parsed;
  } catch (e) {
    log.warn({ err: e }, "semantic_operation_resolver failed");
    return fallback;
  }
}
