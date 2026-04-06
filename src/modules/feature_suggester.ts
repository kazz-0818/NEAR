import OpenAI from "openai";
import { getEnv } from "../config/env.js";
import { loadPrompt } from "../lib/promptLoader.js";
import { getLogger } from "../lib/logger.js";
import { onSuggestionCreated } from "../services/growth_orchestrator.js";
import { recordFunnelStep } from "../services/growth_funnel_service.js";
import { markUnsupportedGrowthSkipped } from "../services/growth_suggestion_gate.js";
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
  inboundMessageId?: number;
  channel?: string;
  channelUserId?: string;
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
    try {
      await recordFunnelStep(input.db, {
        step: "suggestion_skipped_duplicate",
        unsupportedRequestId: input.unsupportedId,
        inboundMessageId: input.inboundMessageId ?? null,
        channel: input.channel,
        channelUserId: input.channelUserId,
        reasonCode: "duplicate_suggestion_for_unsupported",
        detail: { existing_suggestion_id: Number(dup.rows[0]?.id) },
      });
    } catch (e) {
      log.warn({ err: e }, "growth funnel duplicate event failed");
    }
    return;
  }

  try {
    const sys = await systemPrompt();
    const capabilityLines = await listCapabilityLines(input.db);
    const userPayload = JSON.stringify(
      {
        user_message: input.originalMessage,
        detected_intent: input.intent.intent,
        reason: input.intent.reason,
        suggested_category: input.intent.suggested_category,
        registered_intents: listRegisteredIntents(),
        capability_lines: capabilityLines,
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

    if (parsed.trivially_infeasible) {
      const note = String(parsed.trivially_infeasible_reason ?? "").trim().slice(0, 400);
      await markUnsupportedGrowthSkipped(
        input.db,
        input.unsupportedId,
        `trivially_infeasible tier=${parsed.growth_difficulty_tier}${note ? `: ${note}` : ""}`
      );
      try {
        await recordFunnelStep(input.db, {
          step: "suggestion_rejected_trivial",
          unsupportedRequestId: input.unsupportedId,
          inboundMessageId: input.inboundMessageId ?? null,
          channel: input.channel,
          channelUserId: input.channelUserId,
          allowed: false,
          reasonCode: "trivially_infeasible",
          detail: { tier: parsed.growth_difficulty_tier, note },
        });
      } catch (e) {
        log.warn({ err: e }, "growth funnel trivial event failed");
      }
      log.info(
        { unsupportedId: input.unsupportedId, tier: parsed.growth_difficulty_tier },
        "feature_suggester: skipped trivially infeasible growth"
      );
      return;
    }

    const ins = await input.db.query<{ id: string }>(
      `INSERT INTO implementation_suggestions (
         unsupported_request_id, summary, required_apis, suggested_modules, data_stores,
         steps, difficulty, priority_score, raw_llm,
         approval_status, cursor_prompt, improvement_kind, risk_level, estimated_effort,
         implementation_state
       ) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8, $9::jsonb,
         'pending', $10, $11, $12, $13, 'awaiting_user_consent')
       RETURNING id`,
      [
        input.unsupportedId,
        parsed.summary,
        JSON.stringify(parsed.required_apis),
        JSON.stringify(parsed.new_modules),
        JSON.stringify(parsed.data_stores),
        JSON.stringify(parsed.steps),
        parsed.growth_difficulty_tier,
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

    await input.db.query(
      `UPDATE unsupported_requests SET status = 'suggestion_created', updated_at = now() WHERE id = $1`,
      [input.unsupportedId]
    );

    try {
      await recordFunnelStep(input.db, {
        step: "suggestion_created",
        unsupportedRequestId: input.unsupportedId,
        inboundMessageId: input.inboundMessageId ?? null,
        channel: input.channel,
        channelUserId: input.channelUserId,
        allowed: true,
        reasonCode: "ok",
        detail: { suggestion_id: suggestionId },
      });
    } catch (evErr) {
      log.warn({ err: evErr }, "growth funnel suggestion_created event failed");
    }

    await onSuggestionCreated(input.db, suggestionId);
  } catch (e) {
    log.warn({ err: e, unsupportedId: input.unsupportedId }, "feature_suggester failed");
    try {
      await recordFunnelStep(input.db, {
        step: "suggestion_generation_failed",
        unsupportedRequestId: input.unsupportedId,
        inboundMessageId: input.inboundMessageId ?? null,
        channel: input.channel,
        channelUserId: input.channelUserId,
        reasonCode: "exception",
        detail: {
          message: e && typeof e === "object" && "message" in e ? String((e as Error).message).slice(0, 400) : "unknown",
        },
      });
    } catch {
      /* ignore */
    }
  }
}

export function scheduleFeatureSuggestion(input: {
  db: Db;
  unsupportedId: number;
  originalMessage: string;
  intent: ParsedIntent;
  inboundMessageId?: number;
  channel?: string;
  channelUserId?: string;
}): void {
  setImmediate(() => {
    void generateAndSaveSuggestion(input).catch(() => undefined);
  });
}
