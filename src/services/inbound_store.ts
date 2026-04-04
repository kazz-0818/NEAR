import type { Db } from "../db/client.js";

export type SaveInboundInput = {
  channel: string;
  channelUserId: string;
  messageId: string;
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
    `INSERT INTO inbound_messages (channel, channel_user_id, message_id, message_type, text, raw_payload)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (channel, message_id) DO NOTHING
     RETURNING id`,
    [
      input.channel,
      input.channelUserId,
      input.messageId,
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
