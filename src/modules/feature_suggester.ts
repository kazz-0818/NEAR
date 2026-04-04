import OpenAI from "openai";
import { getEnv } from "../config/env.js";
import { loadPrompt } from "../lib/promptLoader.js";
import { getLogger } from "../lib/logger.js";
import { messageFingerprint } from "../lib/messageFingerprint.js";
import { notifyAdminNewSuggestion } from "../jobs/adminGrowthNotify.js";
import {
  FEATURE_SUGGESTION_JSON_SCHEMA,
  featureSuggestionSchema,
  type ParsedIntent,
} from "../models/intent.js";
import { listCapabilityLines } from "./capabilities.js";
import { listRegisteredIntents } from "./registry.js";
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

  const dup = await input.db.query(
    `SELECT id FROM implementation_suggestions WHERE unsupported_request_id = $1 LIMIT 1`,
    [input.unsupportedId]
  );
  if (dup.rows.length > 0) {
    log.info({ unsupportedId: input.unsupportedId }, "feature_suggester skip: suggestion already exists");
    return;
  }

  try {
    const sys = await systemPrompt();
    const userPayload = JSON.stringify(
      {
        user_message: input.originalMessage,
        detected_intent: input.intent.intent,
        reason: input.intent.reason,
        suggested_category: input.intent.suggested_category,
        registered_intents: listRegisteredIntents(),
        capability_lines: listCapabilityLines(),
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

    const ins = await input.db.query<{ id: string }>(
      `INSERT INTO implementation_suggestions (
         unsupported_request_id, summary, required_apis, new_modules, data_stores,
         steps, difficulty, priority_score, raw_llm,
         approval_status, cursor_prompt, improvement_kind, risk_level, estimated_effort
       ) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8, $9::jsonb,
         'pending', $10, $11, $12, $13)
       RETURNING id`,
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
        parsed.cursor_prompt,
        parsed.improvement_kind,
        parsed.risk_level,
        parsed.estimated_effort,
      ]
    );
    const suggestionId = Number(ins.rows[0]?.id);
    if (!Number.isFinite(suggestionId)) return;

    const fp = messageFingerprint(input.originalMessage);
    await notifyAdminNewSuggestion({
      db: input.db,
      messageFingerprint: fp,
      suggestionId,
      summary: parsed.summary,
      difficulty: parsed.difficulty,
    });
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
