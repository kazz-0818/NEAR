/**
 * グループ／トークルームでは、公式アカウントへのメンションがあるときだけ応答する。
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
