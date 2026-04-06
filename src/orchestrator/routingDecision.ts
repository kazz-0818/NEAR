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
 * 影モードでも、FAQ よりエージェント（`web_search_preview` 等）を優先したい発話。
 * `simple_question` は既定でレガシー FAQ に流れがちで「ウェブ検索はできない」と答えやすいため。
 */
function looksLikeWebResearchIntent(userText: string): boolean {
  const t = userText.trim();
  if (t.length < 2) return false;
  return /(調査|調べて|調べる|検索して|ググっ|最新の|いまの|今の|リアルタイム|為替|株価|出典|ソース|根拠|ウェブ|ｗｅｂ|\bweb\b|ネットで|インターネット|公式.*(サイト|ページ)|ニュース|速報|天気|気温|降水)/i.test(
    t
  );
}

/**
 * エージェント（Responses + ツール）を起動すべきか。
 * - シートは routable なら常にレガシー優先（状態機械・既存 sheets_query）。
 * - Phase2 フラグで副作用 intent をエージェント経由に寄せられる。
 */
export function shouldInvokeNearAgent(
  env: Env,
  intent: IntentName,
  legacyRoutable: boolean,
  userText?: string
): boolean {
  if (!env.NEAR_AGENT_ENABLED) return false;

  if ((intent === "google_sheets_query" || intent === "google_calendar_query") && legacyRoutable)
    return false;

  if (
    userText &&
    env.NEAR_AGENT_SHADOW &&
    legacyRoutable &&
    intent === "simple_question" &&
    looksLikeWebResearchIntent(userText)
  ) {
    return true;
  }

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
