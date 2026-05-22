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
  if (n.includes("ニア") || n.includes("にあ") || n.includes("ねあ")) return true;
  return /(^|[^A-Za-z0-9])NEAR([^A-Za-z0-9]|$)/i.test(n);
}

/**
 * テキスト先頭にある bot 名呼びかけを除去する。
 * 対応形式:
 *   - 「ニア　ザキの権限変更したい」→「ザキの権限変更したい」
 *   - 「@NEAR-ニア- メンバー」→「メンバー」（LINE グループのメンション形式）
 *   - 「`member`」→「member」（バッククォート除去も行う）
 */
export function stripBotNamePrefix(text: string): string {
  let t = text.normalize("NFKC").trimStart();
  // LINE グループのメンション形式: @{任意の表示名} (例: @NEAR-ニア-)
  t = t.replace(/^@[^\s　,、，。！!？?\u0000-\u001f\u007f]+\s*/u, "").trimStart();
  // 「ニア」「NEAR」単体の呼びかけ
  t = t.replace(/^(?:ニア|にあ|ねあ|NEAR)\s*[、,，　\s]*(?=\S)/iu, "").trimStart();
  // バッククォートで囲まれたロール名を展開（「`member`」→「member」）
  t = t.replace(/^`([^`]+)`$/u, "$1").trimStart();
  return t;
}

/** LINE 表示名 API 用（group / room を正しいエンドポイントに振り分け） */
export type LineMemberProfileContext = { groupId?: string; roomId?: string };

export function getLineMemberProfileContext(
  source: Record<string, unknown> | undefined
): LineMemberProfileContext {
  if (!source) return {};
  if (source.type === "group" && typeof source.groupId === "string" && source.groupId.trim()) {
    return { groupId: source.groupId.trim() };
  }
  if (source.type === "room" && typeof source.roomId === "string" && source.roomId.trim()) {
    return { roomId: source.roomId.trim() };
  }
  return {};
}

/** グループなら groupId、トークルームなら roomId（それ以外は undefined） */
export function getLineGroupOrRoomId(source: Record<string, unknown> | undefined): string | undefined {
  if (!source) return undefined;
  if (source.type === "group" && typeof source.groupId === "string" && source.groupId.trim()) {
    return source.groupId.trim();
  }
  if (source.type === "room" && typeof source.roomId === "string" && source.roomId.trim()) {
    return source.roomId.trim();
  }
  return undefined;
}

/** GROWTH_APPROVAL_GROUP_ID（環境変数）と同一のグループ／ルームか */
export function isConfiguredGrowthApprovalGroup(
  source: Record<string, unknown> | undefined,
  configuredGroupOrRoomId: string | undefined
): boolean {
  const cfg = configuredGroupOrRoomId?.trim();
  if (!cfg) return false;
  const id = getLineGroupOrRoomId(source);
  return id === cfg;
}
