import type { Env } from "../config/env.js";
import { shouldUseNearAgent } from "../agent/eligibility.js";
import type { IntentName } from "../models/intent.js";

const PHASE2_SIDE_EFFECT_INTENTS = new Set<IntentName>([
  "task_create",
  "memo_save",
  "reminder_request",
  "summarize",
]);

/**
 * エージェント（Responses + ツール）を起動すべきか。
 * - シートは routable なら常にレガシー優先（状態機械・既存 sheets_query）。
 * - Phase2 フラグで副作用 intent をエージェント経由に寄せられる。
 */
export function shouldInvokeNearAgent(
  env: Env,
  intent: IntentName,
  legacyRoutable: boolean
): boolean {
  if (!env.NEAR_AGENT_ENABLED) return false;

  if (intent === "google_sheets_query" && legacyRoutable) return false;

  if (
    env.NEAR_PHASE2_SIDE_EFFECTS_VIA_AGENT &&
    legacyRoutable &&
    PHASE2_SIDE_EFFECT_INTENTS.has(intent)
  ) {
    return true;
  }

  return shouldUseNearAgent({ env, intent, legacyRoutable });
}

/**
 * `google_sheets_query` でレガシーモジュールを直接叩くべきか（エージェントより先）。
 */
export function shouldUseLegacySheetsModule(intent: IntentName, legacyRoutable: boolean): boolean {
  return intent === "google_sheets_query" && legacyRoutable;
}
