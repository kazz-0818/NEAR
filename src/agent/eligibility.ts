import type { Env } from "../config/env.js";
import type { IntentName } from "../models/intent.js";

/** Primary 時にエージェントが主担当になりうる意図（レガシーと重複しうる領域） */
const AGENT_PRIMARY_INTENTS = new Set<IntentName>(["simple_question", "unknown_custom_request"]);

/**
 * スプレッドシートの番号選択・確認・スレッド追従はレガシー orchestrator のまま確実に処理する。
 * それ以外でエージェントを使うかどうか。
 */
export function shouldUseNearAgent(input: {
  env: Env;
  intent: IntentName;
  legacyRoutable: boolean;
}): boolean {
  if (!input.env.NEAR_AGENT_ENABLED) return false;

  if (input.intent === "google_sheets_query" && input.legacyRoutable) return false;

  if (input.env.NEAR_AGENT_SHADOW) {
    return !input.legacyRoutable;
  }

  return AGENT_PRIMARY_INTENTS.has(input.intent) || !input.legacyRoutable;
}
