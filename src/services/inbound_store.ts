import type { Db } from "../db/client.js";

export type SaveInboundInput = {
  channel: string;
  channelUserId: string;
  /** グループ内で実際に発言したユーザーの LINE userId（個人1:1 では channelUserId と同じため省略可） */
  actorUserId?: string | null;
  /** グループ/ルームの LINE ID。個人1:1 の場合は null/undefined。 */
  groupId?: string | null;
  messageId: string;
  quotedMessageId?: string | null;
  messageType: string;
  text: string | null;
  rawPayload: unknown;
};

export type SaveInboundResult = {
  id: number;
  isDuplicate: boolean;
};

export async function saveInboundMessage(db: Db, input: SaveInboundInput): Promise<SaveInboundResult> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO inbound_messages (channel, channel_user_id, actor_user_id, group_id, message_id, quoted_message_id, message_type, text, raw_payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     ON CONFLICT (channel, message_id) DO NOTHING
     RETURNING id`,
    [
      input.channel,
      input.channelUserId,
      input.actorUserId ?? null,
      input.groupId ?? null,
      input.messageId,
      input.quotedMessageId ?? null,
      input.messageType,
      input.text,
      JSON.stringify(input.rawPayload ?? {}),
    ]
  );
  if (res.rows[0]?.id) {
    return { id: Number(res.rows[0].id), isDuplicate: false };
  }
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM inbound_messages WHERE channel = $1 AND message_id = $2`,
    [input.channel, input.messageId]
  );
  const id = existing.rows[0]?.id;
  if (!id) throw new Error("Inbound insert conflict but row missing");
  return { id: Number(id), isDuplicate: true };
}
