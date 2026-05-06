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
 * `simple_question` は既定でレガシー FAQ に流れがちで、最新性が要る依頼で断り回答に寄りやすいため。
 */
function looksLikeWebResearchIntent(userText: string): boolean {
  const t = userText.trim();
  if (t.length < 2) return false;
  return /(調査|調べて|調べる|検索して|ググっ|最新の|いまの|今の|現在の|リアルタイム|出典|ソース|根拠|一次情報|ウェブ|ｗｅｂ|\bweb\b|ネットで|インターネット|公式.*(サイト|ページ)|速報)/i.test(
    t
  );
}

/** GPT寄りに、一般相談・比較・作成依頼も Agent 側で巻き取りやすくする。 */
function looksLikeBroadAssistantIntent(userText: string): boolean {
  const t = userText.trim();
  if (t.length < 4) return false;
  return /(比較|違い|メリット|デメリット|提案|アイデア|案を出|壁打ち|整理|要点|手順|進め方|どうすれば|なぜ|理由|改善|添削|言い換え|文章|返信文|メール|下書き|テンプレ|計画|ロードマップ|優先順位)/i.test(
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
    env.NEAR_AGENT_SIMPLE_QUESTION_PRIMARY &&
    legacyRoutable &&
    intent === "simple_question" &&
    (!userText || looksLikeBroadAssistantIntent(userText) || userText.trim().length >= 2)
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
