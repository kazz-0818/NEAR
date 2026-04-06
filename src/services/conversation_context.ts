import type { Db } from "../db/client.js";

export type LoadRecentUserMessagesOptions = {
  limit?: number;
  maxCharsPerMessage?: number;
};

/**
 * 同一 channel / ユーザーについて、現在の inbound より前のユーザー発言を古い順で返す（会話の踏襲用）。
 */
/** 直前のユーザー inbound（今回より前の最新 1 件）。短時間再発話シグナル用。 */
export async function getPreviousInboundMeta(
  db: Db,
  channel: string,
  channelUserId: string,
  beforeInboundId: number
): Promise<{ id: number; created_at: Date; text: string } | null> {
  const res = await db.query<{ id: string; created_at: string; text: string | null }>(
    `SELECT id, created_at::text, text FROM inbound_messages
     WHERE channel = $1 AND channel_user_id = $2 AND id < $3
     ORDER BY id DESC LIMIT 1`,
    [channel, channelUserId, beforeInboundId]
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    created_at: new Date(row.created_at),
    text: row.text ?? "",
  };
}

export async function loadRecentUserMessages(
  db: Db,
  channel: string,
  channelUserId: string,
  beforeInboundId: number,
  options: LoadRecentUserMessagesOptions = {}
): Promise<string[]> {
  const limit = options.limit ?? 12;
  const maxChars = options.maxCharsPerMessage ?? 800;

  const res = await db.query<{ text: string }>(
    `SELECT text FROM inbound_messages
     WHERE channel = $1 AND channel_user_id = $2
       AND id < $3
       AND text IS NOT NULL
       AND btrim(text) <> ''
     ORDER BY id DESC
     LIMIT $4`,
    [channel, channelUserId, beforeInboundId, limit]
  );

  const chronological = [...res.rows].reverse();
  return chronological.map((r) => {
    const t = r.text.replace(/\s+/g, " ").trim();
    if (t.length <= maxChars) return t;
    return `${t.slice(0, maxChars)}…`;
  });
}

/**
 * 同一ユーザーについて、今回の inbound より前に送った NEAR 側テキストを古い順で返す（続き一言の文脈用）。
 */
export async function loadRecentAssistantMessages(
  db: Db,
  channel: string,
  channelUserId: string,
  beforeInboundId: number,
  options: LoadRecentUserMessagesOptions = {}
): Promise<string[]> {
  const limit = options.limit ?? 8;
  const maxChars = options.maxCharsPerMessage ?? 12000;

  const res = await db.query<{ text: string }>(
    `SELECT text FROM outbound_messages
     WHERE channel = $1 AND channel_user_id = $2
       AND inbound_message_id IS NOT NULL
       AND inbound_message_id < $3
     ORDER BY inbound_message_id DESC
     LIMIT $4`,
    [channel, channelUserId, beforeInboundId, limit]
  );

  const chronological = [...res.rows].reverse();
  return chronological.map((r) => {
    const t = r.text.replace(/\s+/g, " ").trim();
    if (t.length <= maxChars) return t;
    return `${t.slice(0, maxChars)}…`;
  });
}
