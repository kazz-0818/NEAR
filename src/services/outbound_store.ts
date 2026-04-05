import type { Db } from "../db/client.js";

const MAX_STORED_TEXT_CHARS = 16000;

export type SaveOutboundInput = {
  channel: string;
  channelUserId: string;
  text: string;
  inboundMessageId: number;
};

export async function saveOutboundAssistantText(db: Db, input: SaveOutboundInput): Promise<void> {
  const t = input.text.replace(/\s+/g, " ").trim();
  if (!t) return;
  const stored = t.length <= MAX_STORED_TEXT_CHARS ? t : `${t.slice(0, MAX_STORED_TEXT_CHARS)}…`;
  await db.query(
    `INSERT INTO outbound_messages (channel, channel_user_id, text, inbound_message_id)
     VALUES ($1, $2, $3, $4)`,
    [input.channel, input.channelUserId, stored, input.inboundMessageId]
  );
}
