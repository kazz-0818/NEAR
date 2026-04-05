import type { Db } from "../db/client.js";

export type LoadRecentUserMessagesOptions = {
  limit?: number;
  maxCharsPerMessage?: number;
};

/**
 * 同一 channel / ユーザーについて、現在の inbound より前のユーザー発言を古い順で返す（会話の踏襲用）。
 */
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
