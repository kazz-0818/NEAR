/**
 * グループ／トークルームでは、公式アカウントへのメンションがあるか、
 * 本文に「NEAR」「ニア」が含まれるときだけ応答する。
 * @see https://developers.line.biz/ja/docs/messaging-api/receiving-messages/
 */

export function isLineGroupOrRoomSource(source: Record<string, unknown> | undefined): boolean {
  const t = source?.type;
  return t === "group" || t === "room";
}

/**
 * テキストメッセージでボットがメンションされたか。
 * `isSelf: true` を優先（LINE が付与する場合）。なければ userId を botUserId と照合。
 */
export function textMessageMentionsBot(
  message: Record<string, unknown>,
  botUserId: string
): boolean {
  const mention = message.mention as
    | { mentionees?: Array<{ userId?: string; isSelf?: boolean; type?: string }> }
    | undefined;
  if (!mention?.mentionees?.length) return false;
  return mention.mentionees.some(
    (m) => m.isSelf === true || (m.userId != null && m.userId === botUserId)
  );
}

/**
 * グループで名前で呼びかけたか（全角半角は NFKC で揃える）。
 * 「NEAR」は前後が英数字以外のときだけ一致（linear 等への誤爆を減らす）。
 */
export function textContainsNearNameReferral(raw: string): boolean {
  const n = raw.normalize("NFKC");
  if (n.includes("ニア")) return true;
  return /(^|[^A-Za-z0-9])NEAR([^A-Za-z0-9]|$)/i.test(n);
}
