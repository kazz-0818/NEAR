import OpenAI from "openai";
import { getEnv } from "../config/env.js";
import { loadPrompt } from "../lib/promptLoader.js";
import { getLogger } from "../lib/logger.js";
import {
  FEATURE_SUGGESTION_JSON_SCHEMA,
  featureSuggestionSchema,
  type ParsedIntent,
} from "../models/intent.js";
import type { Db } from "../db/client.js";

let systemCache: string | null = null;

async function systemPrompt(): Promise<string> {
  if (systemCache) return systemCache;
  systemCache = await loadPrompt("prompts/feature_suggestion.system.md");
  return systemCache;
}

export async function generateAndSaveSuggestion(input: {
  db: Db;
  unsupportedId: number;
  originalMessage: string;
  intent: ParsedIntent;
}): Promise<void> {
  const env = getEnv();
  const log = getLogger();
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

  try {
    const sys = await systemPrompt();
    const userPayload = JSON.stringify(
      {
        user_message: input.originalMessage,
        detected_intent: input.intent.intent,
        reason: input.intent.reason,
        suggested_category: input.intent.suggested_category,
      },
      null,
      2
    );

    const completion = await client.chat.completions.create({
      model: env.OPENAI_SUGGESTION_MODEL,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: userPayload },
      ],
      response_format: {
        type: "json_schema",
        json_schema: FEATURE_SUGGESTION_JSON_SCHEMA,
      },
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) return;
    const parsed = featureSuggestionSchema.parse(JSON.parse(raw));

    await input.db.query(
      `INSERT INTO implementation_suggestions (
         unsupported_request_id, summary, required_apis, new_modules, data_stores,
         steps, difficulty, priority_score, raw_llm
       ) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8, $9::jsonb)`,
      [
        input.unsupportedId,
        parsed.summary,
        JSON.stringify(parsed.required_apis),
        JSON.stringify(parsed.new_modules),
        JSON.stringify(parsed.data_stores),
        JSON.stringify(parsed.steps),
        parsed.difficulty,
        Math.min(10, Math.max(1, Math.round(parsed.priority_score))),
        JSON.stringify({ model: env.OPENAI_SUGGESTION_MODEL, raw }),
      ]
    );
  } catch (e) {
    log.warn({ err: e, unsupportedId: input.unsupportedId }, "feature_suggester failed");
  }
}

export function scheduleFeatureSuggestion(input: {
  db: Db;
  unsupportedId: number;
  originalMessage: string;
  intent: ParsedIntent;
}): void {
  setImmediate(() => {
    void generateAndSaveSuggestion(input).catch(() => undefined);
  });
}
