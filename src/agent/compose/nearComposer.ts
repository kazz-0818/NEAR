import { getEnv } from "../../config/env.js";
import { SHEET_READ_SUCCESS_HEADER_REGEX } from "../../lib/sheetReplyMarker.js";
import {
  composeNearReply,
  composeNearReplyLight,
  type ComposeInput,
} from "../../services/reply_composer.js";

export type ComposeMode = "skip" | "light" | "full";

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
    return input.draft;
  }
  if (mode === "light") {
    return composeNearReplyLight(input);
  }
  return composeNearReply(input);
}
