import type { ParsedIntent } from "../models/intent.js";
import { looksLikeGrowthFeatureRequest } from "./growthFeatureRequestHeuristics.js";
import {
  isExplicitGrowthDevelopmentRequest,
  isForcedGrowthOrIssueCommand,
} from "./growthExplicitRequest.js";

export { isExplicitGrowthDevelopmentRequest, isForcedGrowthOrIssueCommand } from "./growthExplicitRequest.js";

/**
 * preGrowth 分類（ログ routing_category やゲートと対応しやすい値）。
 * existing_capability は主に thinRouter / モジュール側で処理済みの想定（ここでは未使用に近い）。
 */
export type PreGrowthCategory =
  | "existing_capability"
  | "llm_answerable"
  | "external_realtime_answer"
  | "growth_explicit"
  | "needs_clarification"
  | "unknown";

export type PreGrowthClassification = {
  category: PreGrowthCategory;
  /** true のときのみ従来の Growth パイプライン（提案スケジュール等）へ進めてよい */
  allowGrowth: boolean;
  /** true のとき runLlmFallbackAnswer を優先（AI 秘書の既定） */
  preferLlmFallback: boolean;
  /** true のとき定型短文（外部事実の幻覚抑制・トークン節約）。LLM でも可だが既定は短文 */
  useShortExternalReply: boolean;
  reason: string;
};

/**
 * 「今この瞬間の外部世界の事実・数値」を一度きり聞いている目安。
 * ジャンル列挙は最小限。再現可能な実装依頼（できるように／自動化／保存…）が含まれるなら外す。
 */
export function impliesLiveDataOrExternalOneShot(text: string): boolean {
  if (isExplicitGrowthDevelopmentRequest(text)) return false;
  const t = text.normalize("NFKC").trim();
  if (!t) return false;
  // 実装・永続運用の依頼はワンショット照会ではない（Growth 明示判定へ）
  if (
    /(できるように|自動化|連携して|保存して|通知して|実装して|追加して|してほしい|したいです|投稿できるように)/i.test(t)
  ) {
    return false;
  }
  const asks = /(教えて|教えてください|調べて|を調べ|はどう|いくら|何％|降水|何℃)/i.test(t);
  const timeFresh = /(今|最新|リアルタイム|本日|今日|明日|現在)/i.test(t);
  // 外部確定値になりやすい話題の目安（網羅ではない）
  const domainHint = /(天気|予報|台風|降水|株|為替|ニュース|速報|近くの|周辺の|店を探|営業中|イベント)/i.test(t);
  return (asks && timeFresh) || (asks && domainHint);
}

/**
 * Growth に載せる前の一括判定。個別例はテストに寄せ、ここでは依頼タイプ中心。
 */
export function classifyPreGrowthRequest(text: string, parsed: ParsedIntent): PreGrowthClassification {
  if (isExplicitGrowthDevelopmentRequest(text) || isForcedGrowthOrIssueCommand(text)) {
    return {
      category: "growth_explicit",
      allowGrowth: true,
      preferLlmFallback: false,
      useShortExternalReply: false,
      reason: "persistent_feature_or_admin_growth_command",
    };
  }

  if (impliesLiveDataOrExternalOneShot(text)) {
    return {
      category: "external_realtime_answer",
      allowGrowth: false,
      preferLlmFallback: false,
      useShortExternalReply: true,
      reason: "likely_one_off_live_or_external_fact",
    };
  }

  const t = text.normalize("NFKC").trim();
  if (parsed.intent === "unknown_custom_request" && [...t].length > 0 && [...t].length <= 4) {
    return {
      category: "needs_clarification",
      allowGrowth: false,
      preferLlmFallback: true,
      useShortExternalReply: false,
      reason: "too_short_ambiguous",
    };
  }

  // 既定: モジュールに当たらなかったらまず AI 秘書（LLM）で理解・回答を試みる
  return {
    category: parsed.intent === "unknown_custom_request" ? "unknown" : "llm_answerable",
    allowGrowth: false,
    preferLlmFallback: true,
    useShortExternalReply: false,
    reason: "default_ai_secretary_llm_first",
  };
}

/** @deprecated classifyPreGrowthRequest の結果を参照 */
export function requiresExternalRealtimeData(text: string): boolean {
  return impliesLiveDataOrExternalOneShot(text);
}

/** @deprecated classifyPreGrowthRequest の llm / unknown / needs_clarification に相当 */
export function isAiAnswerableHeuristic(text: string, parsed: ParsedIntent): boolean {
  const c = classifyPreGrowthRequest(text, parsed);
  return c.category === "llm_answerable" || c.category === "unknown" || c.category === "needs_clarification";
}

/** @deprecated */
export const canAnswerWithLLMFallback = isAiAnswerableHeuristic;

export function buildExternalCapabilityNeededReply(): string {
  return [
    "リアルタイムの外部データや、専用の連携がないと正確に出せない内容かもしれません。今のNEARだけでは、この場で確定値をお出しすることが難しいです。",
    "",
    "NEARの機能として組み込みたい場合は、例えば",
    "「この機能を追加して」",
    "のように送ってください。成長候補として整理できます。",
  ].join("\n");
}

export const buildExternalRealtimeNeededReply = buildExternalCapabilityNeededReply;

/**
 * 単発の Issue 作成依頼（既存フロー／管理者経路）。issue\s*作って 等の Growth ヒューリスティクスと区別する。
 */
export function isStandaloneGithubIssueCreatePhrase(text: string): boolean {
  const t = text.normalize("NFKC").trim();
  if (!/^(GitHub|ギットハブ).{0,24}(Issue|イシュー).{0,14}(作って|作成して|起票して)/i.test(t)) return false;
  if (/(自動|できるように|実装して|連携)/i.test(t)) return false;
  return true;
}

export function buildUnknownClarifyReply(): string {
  return [
    "すみません、少し意図を確認したいです。",
    "",
    "やりたいことを、もう少し具体的に教えてもらえると助かります（例: 文面の作成、タスクの追加、表の読み取り、など）。",
  ].join("\n");
}

/**
 * Growth 提案ゲート用: AI-first で巻き取るべきものは候補化しない。
 * LLM 失敗後にヒューリスティック Growth へ進む場合は looksLikeGrowth が true になり得るため、
 * そのときは allow（明示的な機能拡張っぽさ）を優先する。
 */
export function shouldAllowGrowthSuggestionAfterPreRouter(text: string, parsed: ParsedIntent): boolean {
  const c = classifyPreGrowthRequest(text, parsed);
  if (c.category === "external_realtime_answer") return false;
  if (isStandaloneGithubIssueCreatePhrase(text)) return false;
  if (c.category === "growth_explicit" && c.allowGrowth) return true;
  if (c.category === "needs_clarification") return false;
  if (c.category === "llm_answerable" || c.category === "unknown") {
    if (!looksLikeGrowthFeatureRequest(text)) return false;
  }
  if (looksLikeGrowthFeatureRequest(text)) return true;
  return true;
}
