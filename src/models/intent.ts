import { z } from "zod";
import { GROWTH_DIFFICULTY_TIERS } from "../lib/growth_tiers.js";

export const INTENT_NAMES = [
  "greeting",
  "simple_question",
  "task_create",
  "reminder_request",
  "memo_save",
  "summarize",
  "help_capabilities",
  "unknown_custom_request",
] as const;

export type IntentName = (typeof INTENT_NAMES)[number];

export const parsedIntentSchema = z.object({
  intent: z.enum(INTENT_NAMES),
  confidence: z.number(),
  can_handle: z.boolean(),
  required_params: z.record(z.unknown()).optional().default({}),
  needs_followup: z.boolean(),
  followup_question: z.string().nullable(),
  reason: z.string().nullable(),
  suggested_category: z.string().nullable(),
});

export type ParsedIntent = z.infer<typeof parsedIntentSchema>;

/** OpenAI Structured Outputs: strict JSON Schema */
export const INTENT_JSON_SCHEMA = {
  name: "near_intent",
  /** OpenAI strict mode disallows `additionalProperties: true` on nested objects; params need flexibility. */
  strict: false,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      intent: {
        type: "string",
        enum: [...INTENT_NAMES],
      },
      confidence: { type: "number" },
      can_handle: { type: "boolean" },
      required_params: {
        type: "object",
        additionalProperties: true,
      },
      needs_followup: { type: "boolean" },
      followup_question: {
        type: ["string", "null"],
      },
      reason: {
        type: ["string", "null"],
      },
      suggested_category: {
        type: ["string", "null"],
      },
    },
    required: [
      "intent",
      "confidence",
      "can_handle",
      "required_params",
      "needs_followup",
      "followup_question",
      "reason",
      "suggested_category",
    ],
  },
} as const;

const improvementKindEnum = [
  "prompt_tune",
  "routing_fix",
  "new_module",
  "external_auth",
  "out_of_scope",
] as const;

const growthTierEnum = z.enum(GROWTH_DIFFICULTY_TIERS);

export const featureSuggestionSchema = z.object({
  summary: z.string(),
  required_apis: z.array(z.string()),
  new_modules: z.array(z.string()),
  data_stores: z.array(z.string()),
  steps: z.array(z.string()),
  /** E が最も易しく、SSS が最難。DB の difficulty 列に保存する。 */
  growth_difficulty_tier: growthTierEnum,
  /** true のときは成長パイプラインに載せず growth_skipped とする（非現実的・範囲外の依頼）。 */
  trivially_infeasible: z.boolean(),
  /** trivially_infeasible が true のときは理由を1〜2文。false のときは空文字。 */
  trivially_infeasible_reason: z.string(),
  priority_score: z.number(),
  improvement_kind: z.enum(improvementKindEnum),
  risk_level: z.enum(["low", "medium", "high"]),
  estimated_effort: z.enum(["low", "medium", "high"]),
  /** Cursor に貼る実装指示（1ブロック・日本語）。trivially_infeasible 時は短い説明でよい。 */
  cursor_prompt: z.string().min(1),
});

export type FeatureSuggestion = z.infer<typeof featureSuggestionSchema>;

export const FEATURE_SUGGESTION_JSON_SCHEMA = {
  name: "near_feature_suggestion",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      required_apis: { type: "array", items: { type: "string" } },
      new_modules: { type: "array", items: { type: "string" } },
      data_stores: { type: "array", items: { type: "string" } },
      steps: { type: "array", items: { type: "string" } },
      growth_difficulty_tier: { type: "string", enum: [...GROWTH_DIFFICULTY_TIERS] },
      trivially_infeasible: { type: "boolean" },
      trivially_infeasible_reason: { type: "string" },
      priority_score: { type: "number" },
      improvement_kind: {
        type: "string",
        enum: [...improvementKindEnum],
      },
      risk_level: { type: "string", enum: ["low", "medium", "high"] },
      estimated_effort: { type: "string", enum: ["low", "medium", "high"] },
      cursor_prompt: { type: "string" },
    },
    required: [
      "summary",
      "required_apis",
      "new_modules",
      "data_stores",
      "steps",
      "growth_difficulty_tier",
      "trivially_infeasible",
      "trivially_infeasible_reason",
      "priority_score",
      "improvement_kind",
      "risk_level",
      "estimated_effort",
      "cursor_prompt",
    ],
  },
} as const;
