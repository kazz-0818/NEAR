import type { IntentName } from "../models/intent.js";

/**
 * LINE 上の「機能追加・改善 wish」っぽさ（ルールベース）。通常会話を広く成長候補にしないよう最小文字数あり。
 */
export function looksLikeGrowthFeatureRequest(text: string): boolean {
  const t = text.normalize("NFKC").trim();
  if ([...t].length < 8) return false;

  if (
    /(できるようにして|できない[?？]|できますか|できる[?？]|対応してほしい|対応して|追加してほしい|追加して|実装してほしい|実装依頼|自動化したい|自動化して|連携してほしい|連携して|機能がほしい|機能ほしい|こういう機能|してほしい|したいです|進めて|issue化|issue\s*作って)/iu.test(
      t
    )
  ) {
    return true;
  }

  if (/(NEARで|ニアで|NEARに|ニアに)/iu.test(t) && /(したい|してほしい|できる|対応)/iu.test(t)) {
    return true;
  }

  if (
    /(スプレッドシート|spreadsheet|シート|GitHub|ギットハブ|タスク)/iu.test(t) &&
    /(通知|自動|連携|もっと|賢く|ほしい|したい|できない)/iu.test(t)
  ) {
    return true;
  }

  return false;
}

/** 管理者通知用の粗いカテゴリ（ルールベース） */
export function inferGrowthCandidateCategory(text: string): string {
  const t = text.normalize("NFKC");
  const cats: string[] = [];
  if (/スプレッドシート|spreadsheet|シート/iu.test(t)) cats.push("スプレッドシート");
  if (/GitHub|ギットハブ|\bissue\b|プルリク|\bPR\b/iu.test(t)) cats.push("GitHub連携");
  if (/タスク|todo|リマインダ|期限/iu.test(t)) cats.push("タスク管理");
  if (/通知|LINE|プッシュ|メンション/iu.test(t)) cats.push("通知");
  if (cats.length === 0) return "その他";
  return cats.join(" / ");
}

const EXTENSION_OVERRIDE_INTENTS = new Set<IntentName>([
  "google_sheets_query",
  "google_calendar_query",
  "task_create",
]);

/**
 * 既にハンドラがある分類でも、本文が「既存機能を超える拡張」なら成長パイプラインへ載せる。
 */
export function shouldTreatHandledIntentAsGrowthExtension(text: string, intent: IntentName): boolean {
  if (!EXTENSION_OVERRIDE_INTENTS.has(intent)) return false;
  return looksLikeGrowthFeatureRequest(text);
}
