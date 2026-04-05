import { z } from "zod";
import type { ParsedIntent } from "./intent.js";

export const REQUEST_MODES = [
  "edit_previous_output",
  "continue_previous_task",
  "clarify_missing_info",
  "execute_existing_capability",
  "new_request",
  "unsupported_growth_candidate",
] as const;

export type RequestMode = (typeof REQUEST_MODES)[number];

export const requestInterpretationSchema = z.object({
  mode: z.enum(REQUEST_MODES),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().nullable().optional(),
});

export type RequestInterpretation = z.infer<typeof requestInterpretationSchema>;

/** intent_runs 用の合成 intent（分析・ダッシュボード向け） */
export function syntheticIntentForSecretaryLayer(mode: RequestMode, confidence: number): ParsedIntent {
  return {
    intent: "simple_question",
    confidence,
    can_handle: true,
    required_params: { request_mode: mode },
    needs_followup: false,
    followup_question: null,
    reason: `secretary_layer:${mode}`,
    suggested_category: null,
  };
}
