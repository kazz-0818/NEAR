import OpenAI from "openai";
import { getEnv } from "../config/env.js";
import { loadPrompt } from "../lib/promptLoader.js";
import { getLogger } from "../lib/logger.js";
import {
  INTENT_JSON_SCHEMA,
  type ParsedIntent,
  parsedIntentSchema,
} from "../models/intent.js";
import { buildIntentUserEnvelope } from "../lib/datetimeContext.js";
import { extractSpreadsheetIdFromText } from "../lib/googleSheetsAuth.js";
import {
  matchIntentHeuristic,
  rescueBroadSimpleQuestion,
  rescueCasualShortMessage,
} from "./intentHeuristics.js";

let systemPromptCache: string | null = null;

async function getSystemPrompt(): Promise<string> {
  if (systemPromptCache) return systemPromptCache;
  systemPromptCache = await loadPrompt("prompts/intent.system.md");
  return systemPromptCache;
}

export async function classifyIntent(userText: string): Promise<ParsedIntent> {
  const heuristic = matchIntentHeuristic(userText);
  if (heuristic) {
    return heuristic;
  }

  const sheetIdForced = extractSpreadsheetIdFromText(userText);
  if (sheetIdForced) {
    return {
      intent: "google_sheets_query",
      confidence: 1,
      can_handle: true,
      required_params: { spreadsheet_id: sheetIdForced },
      needs_followup: false,
      followup_question: null,
      reason: "spreadsheet_url_embedded",
      suggested_category: null,
    };
  }

  const env = getEnv();
  const log = getLogger();
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const system = await getSystemPrompt();

  try {
    const completion = await client.chat.completions.create({
      model: env.OPENAI_INTENT_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: buildIntentUserEnvelope(userText) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: INTENT_JSON_SCHEMA,
      },
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("Empty completion");
    const json = JSON.parse(raw) as unknown;
    let parsed = parsedIntentSchema.parse(json);
    // モデルが挨拶・ヘルプだけ can_handle:false にすることがあるので上書き
    if (
      parsed.intent === "greeting" ||
      parsed.intent === "help_capabilities" ||
      parsed.intent === "simple_question" ||
      parsed.intent === "google_sheets_query"
    ) {
      parsed = { ...parsed, can_handle: true };
    }
    if (parsed.intent === "unknown_custom_request" || !parsed.can_handle) {
      const rescue = rescueCasualShortMessage(userText);
      if (rescue) return rescue;
      const broad = rescueBroadSimpleQuestion(userText);
      if (broad) return broad;
    }
    return parsed;
  } catch (e) {
    log.warn({ err: e }, "Intent classification failed, using fallback");
    const rescue = rescueCasualShortMessage(userText);
    if (rescue) return rescue;
    const broad = rescueBroadSimpleQuestion(userText);
    if (broad) return broad;
    return {
      intent: "unknown_custom_request",
      confidence: 0,
      can_handle: false,
      required_params: {},
      needs_followup: false,
      followup_question: null,
      reason: "分類処理に失敗しました",
      suggested_category: "システム安定化",
    };
  }
}
