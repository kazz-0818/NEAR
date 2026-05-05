import { getEnv } from "../../config/env.js";
import { SHEET_READ_SUCCESS_HEADER_REGEX } from "../../lib/sheetReplyMarker.js";
import {
  composeNearReply,
  composeNearReplyLight,
  type ComposeInput,
} from "../../services/reply_composer.js";

export type ComposeMode = "skip" | "light" | "full";

function normalizeDeflectionReply(text: string): string {
  let out = text;
  // 特定年月を断定する言い回しを汎用表現に丸める。
  out = out.replace(
    /私の情報は20\d{2}年\d{1,2}月止まり(?:でして)?、?/g,
    "最新情報をこの場で断定するのが難しく、"
  );
  out = out.replace(
    /私の情報は20\d{2}年\d{1,2}月で止まって(?:いる|いて)(?:ため)?、?/g,
    "最新情報をこの場で断定するのが難しく、"
  );

  const looksLikeDeflection =
    /最新[^。\n]{0,30}(?:提供|お伝え|案内)[^。\n]{0,20}できません|情報は20\d{2}年\d{1,2}月[^。\n]{0,40}止まって|気象庁|公式アプリ|公式サイト/.test(
      out
    );
  const hasPersonalHearingLine = /個人\s*LINE|個人ライン/.test(out);
  if (looksLikeDeflection && !hasPersonalHearingLine) {
    out += "\n\n必要なら個人LINEでヒアリングして、改善候補として進めます。";
  }
  return out;
}

/** 候補番号リスト（・1. 形式）など、整形で事実が壊れやすい followup */
function looksLikeNumberedChoiceListDraft(draft: string): boolean {
  return /・\s*\d+\./.test(draft);
}

/**
 * auto: ドラフトと状況から skip / light / full。
 * NEAR_COMPOSE_MODE=full: 事実保護スキップのみ適用し、それ以外は常に full 整形。
 */
export function classifyComposeMode(draft: string, situation: ComposeInput["situation"]): ComposeMode {
  const env = getEnv();

  if (situation === "success" && SHEET_READ_SUCCESS_HEADER_REGEX.test(draft)) {
    return "skip";
  }

  if (situation === "followup" && looksLikeNumberedChoiceListDraft(draft)) {
    return "skip";
  }

  if (env.NEAR_COMPOSE_MODE === "full") {
    return "full";
  }

  if (situation === "followup" && env.NEAR_COMPOSE_LIGHT_ENABLED) {
    return "light";
  }

  if (situation === "followup" && !env.NEAR_COMPOSE_LIGHT_ENABLED) {
    return "skip";
  }

  return "full";
}

/**
 * 全経路共通の返信整形入口（skip / light / full）。
 */
export async function composeNearReplyUnified(input: ComposeInput): Promise<string> {
  const mode = classifyComposeMode(input.draft, input.situation);
  if (mode === "skip") {
    return normalizeDeflectionReply(input.draft);
  }
  if (mode === "light") {
    return normalizeDeflectionReply(await composeNearReplyLight(input));
  }
  return normalizeDeflectionReply(await composeNearReply(input));
}
