import type { IntentName, ParsedIntent } from "../models/intent.js";

/** エージェントツールから既存モジュールを呼ぶときの意図（分類器を経由しない） */
export function syntheticAgentIntent(
  intent: IntentName,
  requiredParams: Record<string, unknown> = {}
): ParsedIntent {
  return {
    intent,
    confidence: 1,
    can_handle: true,
    required_params: requiredParams,
    needs_followup: false,
    followup_question: null,
    reason: "near_agent_tool",
    suggested_category: null,
  };
}
