/** エージェント runner が返すソフト失敗文案（比較用） */
export const NEAR_AGENT_SOFT_FAILURE_SUBSTRING = "外部の情報を取りに行く処理で一時的にうまくいきませんでした";

export function nearAgentSoftFailureMessage(): string {
  return `${NEAR_AGENT_SOFT_FAILURE_SUBSTRING}。少し時間を置いてもう一度お試しください。`;
}

export function looksLikeAgentSoftFailureReply(text: string): boolean {
  return text.includes(NEAR_AGENT_SOFT_FAILURE_SUBSTRING);
}
