import type { ParsedIntent } from "../models/intent.js";
import { looksLikeGrowthFeatureRequest } from "./growthFeatureRequestHeuristics.js";
import {
  isExplicitGrowthDevelopmentRequest,
  isForcedGrowthOrIssueCommand,
} from "./growthExplicitRequest.js";

export { isExplicitGrowthDevelopmentRequest, isForcedGrowthOrIssueCommand } from "./growthExplicitRequest.js";

/**
 * 分析用の分類ラベル想定（ログ routing_category 等と対応しやすいようコメントのみ）:
 * existing_module_request / admin_growth_command / ai_answerable_request /
 * external_capability_needed / explicit_growth_request / unknown_but_answerable / unsupported_unknown
 */

/**
 * 定型モジュール外でも、まず LLM で自然に応答できる依頼か（Growth より前に置く判定用）。
 */
export function isAiAnswerableHeuristic(text: string, parsed: ParsedIntent): boolean {
  if (isExplicitGrowthDevelopmentRequest(text)) return false;
  if (isForcedGrowthOrIssueCommand(text)) return false;
  if (requiresExternalRealtimeData(text)) return false;

  const t = text.normalize("NFKC").trim();
  if (!t) return false;

  if (/文面.{0,6}(考えて|作って|直して|修正して)/i.test(t)) return true;

  if (
    /(文(面|章)?|営業|投稿|LINE|メルカリ|説明文|キャッチコピー|返信|メール|プロンプト|指示文|文案).{0,10}(作って|考えて|書いて|ください|出して)/i.test(
      t
    )
  ) {
    return true;
  }
  if (/(校閲|推敲|要約|説明).*(して|ください)|この文章|ここの文章|文章を整えて|整えてください|直して|修正して/i.test(t)) {
    return true;
  }
  if (/要約して|説明して|比較して|整理して|壁打ち/i.test(t)) return true;
  if (/どう思う|相談(したい|に乗って)|アイデア.{0,8}(出して|を出して)|企画.{0,8}(考えて|整理して)/i.test(t)) return true;
  if (/使い方.*教えて|意味.*教えて|これは何/i.test(t)) return true;
  if (/(Cursor|カーソル).{0,16}(指示|プロンプト|依頼).{0,8}(作って|出して|考えて)/i.test(t)) return true;
  if (/(プロンプト|指示文).{0,6}(作って|考えて|出して)/i.test(t)) return true;
  if (parsed.intent === "unknown_custom_request" && t.length <= 120) {
    if (/(教えて|教えてください|教えてほしい)$/.test(t) && /(使い方|意味|理由|違い|ポイント)/i.test(t)) return true;
  }
  return false;
}

/** @deprecated 互換名。isAiAnswerableHeuristic と同じ。 */
export const canAnswerWithLLMFallback = isAiAnswerableHeuristic;

/**
 * リアルタイムの外部データ取得が主目的で、現状の NEAR では未実装のもの。
 * 明示的な開発依頼が同文に含まれる場合は false（Growth 側へ）。
 */
export function requiresExternalRealtimeData(text: string): boolean {
  if (isExplicitGrowthDevelopmentRequest(text)) return false;
  const t = text.normalize("NFKC").trim();
  if (!t) return false;
  if (/天気|気温|降水|台風|傘が必要|暑さ指数/i.test(t) && /(教えて|調べて|はどう|どう\?|？|予報|今日|明日|週間)/i.test(t)) return true;
  if (/(ニュース|速報|ヘッドライン).*(教えて|調べて|最新)/i.test(t)) return true;
  if (/(株価|為替|円ドル|ドル円|日経|NASDAQ).*(教えて|いくら|どう)/i.test(t)) return true;
  if (/(近くの|周辺の|徒歩圏|今営業|営業中).{0,12}(店|レストラン|カフェ)/i.test(t)) return true;
  if (/(今の|リアルタイム|最新の).{0,12}(状況|情報|件数|人数)/i.test(t)) return true;
  if (/為替レート|指数は/i.test(t)) return true;
  if (/最新情報.{0,10}(調べて|を調べ|教えて|は)/i.test(t)) return true;
  if (/(今日|本日)のイベント/i.test(t)) return true;
  if (/(店|飲食店).{0,8}(探して|検索して)/i.test(t) && /(近く|周辺|付近)/i.test(t)) return true;
  return false;
}

export function buildExternalCapabilityNeededReply(): string {
  return [
    "それは外部情報や専用連携が必要な内容かもしれません。今のNEARだけでは、この場で正確に実行した結果をお出しすることが難しいです。",
    "",
    "NEARの機能として追加したい場合は、例えば",
    "「この機能を追加して」",
    "のように送ってください。成長候補として整理できます。",
  ].join("\n");
}

/** @deprecated 名称変更前の互換 */
export const buildExternalRealtimeNeededReply = buildExternalCapabilityNeededReply;

export function buildUnknownClarifyReply(): string {
  return [
    "すみません、少し意図を確認したいです。",
    "",
    "やりたいことを、もう少し具体的に教えてもらえると助かります（例: 文面の作成、タスクの追加、表の読み取り、など）。",
  ].join("\n");
}

/** growth_suggestion_gate: 記録済み unsupported に対し suggestion を進めてよいかの追加判定 */
export function shouldAllowGrowthSuggestionAfterPreRouter(text: string, parsed: ParsedIntent): boolean {
  if (requiresExternalRealtimeData(text) && !isExplicitGrowthDevelopmentRequest(text)) return false;
  if (isAiAnswerableHeuristic(text, parsed)) return false;
  if (isForcedGrowthOrIssueCommand(text)) return true;
  if (isExplicitGrowthDevelopmentRequest(text)) return true;
  if (looksLikeGrowthFeatureRequest(text)) return true;
  return true;
}
