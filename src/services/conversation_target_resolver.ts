/**
 * 「これ」「それ」等の省略時に、編集・参照の対象となるテキストを解決する。
 * MVP: 直近の NEAR 返答（assistant 履歴の最後）を編集対象とする。
 */

export function resolveLatestAssistantTextForEdit(recentAssistantMessages: string[]): string | null {
  const nonEmpty = recentAssistantMessages.filter((s) => s.trim().length > 0);
  if (nonEmpty.length === 0) return null;
  const last = nonEmpty[nonEmpty.length - 1]!.trim();
  return last.length > 0 ? last : null;
}
