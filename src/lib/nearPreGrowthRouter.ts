import type { ParsedIntent } from "../models/intent.js";
import { looksLikeGrowthFeatureRequest } from "./growthFeatureRequestHeuristics.js";

/**
 * 単発の「Issue を作って」依頼（エージェント／管理者コマンド側で扱う想定）。
 * `issue\s*作って` だけだと looksLikeGrowthFeatureRequest に掛かりやすいので除外する。
 */
export function isCasualGithubIssueCreationUtterance(text: string): boolean {
  const t = text.normalize("NFKC").trim();
  if (t.length > 120) return false;
  if (/(できるように|自動化して|追加して|実装して|連携を)/i.test(t)) return false;
  if (/(GitHub|ギットハブ).{0,20}(Issue|イシュー).{0,14}(作って|作成して|起票して|ください|お願い)/i.test(t)) return true;
  if (/^issue\s*(作って|作成して)/i.test(t)) return true;
  return false;
}

/**
 * ユーザーが NEAR 本体への**機能追加・永続実装**を明示しているか。
 * 「天気を調べて」だけでは false、「NEARで天気を…できるように」は true。
 */
export function isExplicitGrowthDevelopmentRequest(text: string): boolean {
  const t = text.normalize("NFKC").trim();
  if (!t) return false;
  if (
    /(NEAR|ニア).{0,80}(できるように|調べられるように|使えるように|してほしい|対応して|追加して|実装して|連携して)/i.test(t)
  ) {
    return true;
  }
  if (/(できるようにして|できるように|機能を追加|機能追加|API連携.*追加|連携.*追加して)/i.test(t)) return true;
  if (/(自動化して|毎朝|毎日|毎週|定期).{0,120}(通知|送って|リマインド|LINE通知|LINEで|教えて)/i.test(t)) return true;
  if (/(スプレッドシート|スプシ|シート).{0,48}(読める|表示|抽出|出せるように|できるように|対応)/i.test(t)) return true;
  if (/GitHub.{0,24}(Issue|イシュー|PR).{0,24}(自動|作れるように|できるように|追加)/i.test(t)) return true;
  if (/(タスク|リマインド).{0,20}(できるように|追加|自動)/i.test(t)) return true;
  return false;
}

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

export function buildExternalRealtimeNeededReply(): string {
  return [
    "現在のNEARでは、リアルタイムの天気・ニュース・株価などの外部データ取得にはまだ対応していません。",
    "",
    "正確な数値や最新状況を出すには、天気API・Web検索連携などの追加実装が必要です。",
    "",
    "必要であれば、例えば次のように送ってください。",
    "「天気API連携を追加して」",
    "",
    "その場合は成長案として開発に回せます。",
  ].join("\n");
}

/**
 * 定型モジュールなしでも、単発の LLM 応答で十分な依頼か。
 */
export function canAnswerWithLLMFallback(text: string, parsed: ParsedIntent): boolean {
  if (isExplicitGrowthDevelopmentRequest(text)) return false;
  if (requiresExternalRealtimeData(text)) return false;
  if (looksLikeGrowthFeatureRequest(text)) return false;

  const t = text.normalize("NFKC").trim();
  if (!t) return false;

  if (
    /(文(面|章)?|営業|投稿|LINE|メルカリ|説明文|キャッチコピー).{0,6}(作って|考えて|書いて|ください)/i.test(t)
  ) {
    return true;
  }
  if (/(校閲|推敲).*(して|ください)|この文章|ここの文章|文章を整えて|整えてください/i.test(t)) return true;
  if (/要約して|説明して|アイデア.{0,6}(出して|を出して)|どう思う|相談(したい|に乗って)|使い方.*教えて|意味.*教えて|これは何/i.test(t)) {
    return true;
  }
  if (parsed.intent === "unknown_custom_request" && t.length <= 120) {
    if (/(教えて|教えてください|教えてほしい)$/.test(t) && /(使い方|意味|理由|違い|ポイント)/i.test(t)) return true;
  }
  return false;
}

/** growth_suggestion_gate: 記録済み unsupported に対し suggestion を進めてよいかの追加判定 */
export function shouldAllowGrowthSuggestionAfterPreRouter(text: string, parsed: ParsedIntent): boolean {
  if (requiresExternalRealtimeData(text) && !isExplicitGrowthDevelopmentRequest(text)) return false;
  if (canAnswerWithLLMFallback(text, parsed)) return false;
  if (isCasualGithubIssueCreationUtterance(text)) return false;
  if (isExplicitGrowthDevelopmentRequest(text)) return true;
  if (looksLikeGrowthFeatureRequest(text)) return true;
  return true;
}
