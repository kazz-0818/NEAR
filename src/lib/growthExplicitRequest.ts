/**
 * ユーザーが NEAR 本体への永続機能追加・運用変更を明示しているか（ルールベース）。
 * 「天気を調べて」だけでは false、「NEARで…できるように」「毎朝通知」などは true。
 */

export function isExplicitGrowthDevelopmentRequest(text: string): boolean {
  const t = text.normalize("NFKC").trim();
  if (!t) return false;
  if (
    /(NEAR|ニア).{0,80}(できるように|調べられるように|使えるように|してほしい|対応して|追加して|実装して|連携して)/i.test(t)
  ) {
    return true;
  }
  if (/(できるようにして|できるように|機能を追加|機能追加|この機能を追加して|この機能を追加|API連携.*追加|連携.*追加して)/i.test(t)) {
    return true;
  }
  if (/(外部API|Web\s*API).{0,24}(と.?連携|連携して|つないで|追加)/i.test(t)) return true;
  if (/(自動化して|毎朝|毎日|毎週|定期).{0,120}(通知|送って|リマインド|LINE通知|LINEで|教えて)/i.test(t)) return true;
  if (/(スプレッドシート|スプシ|シート).{0,50}(に|へ).{0,12}(保存|書き込み|追記|記録|自動保存).{0,12}(して|したい|できるように)/i.test(t)) {
    return true;
  }
  if (/(スプレッドシート|スプシ|シート).{0,48}(読める|表示|抽出|出せるように|できるように|対応)/i.test(t)) return true;
  if (/GitHub.{0,24}(Issue|イシュー|PR).{0,24}(自動|作れるように|できるように|追加)/i.test(t)) return true;
  if (/(タスク|リマインド).{0,20}(できるように|追加|自動)/i.test(t)) return true;
  return false;
}

/**
 * 明示の成長／Issue 操作コマンド（定型の依頼文で、LLM 雑談に回さない）。
 */
export function isForcedGrowthOrIssueCommand(text: string): boolean {
  const t = text.normalize("NFKC").trim();
  if (!t) return false;
  if (/成長案にして|要望を\s*Issue\s*化|issue\s*化して|イシュー化して/i.test(t)) return true;
  if (/Cursorに投げて|カーソルに投げて|実装依頼して/i.test(t)) return true;
  if (/(GitHub|ギットハブ).{0,24}(Issue|イシュー).{0,16}(作って|作成して|起票して)/i.test(t)) return true;
  return false;
}
