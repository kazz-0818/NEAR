import { z } from "zod";

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

export const featureSuggestionSchema = z.object({
  summary: z.string(),
  required_apis: z.array(z.string()),
  new_modules: z.array(z.string()),
  data_stores: z.array(z.string()),
  steps: z.array(z.string()),
  difficulty: z.enum(["low", "medium", "high"]),
  priority_score: z.number(),
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
      difficulty: { type: "string", enum: ["low", "medium", "high"] },
      priority_score: { type: "number" },
    },
    required: [
      "summary",
      "required_apis",
      "new_modules",
      "data_stores",
      "steps",
      "difficulty",
      "priority_score",
    ],
  },
} as const;
