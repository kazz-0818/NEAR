import type { VelioraDb } from "../client.js";
import { VERIORA_TABLES } from "../schema.js";

export type UpsertConversationInput = {
  agentId: string;
  source: string;
  conversationKey: string;
  lineUserId?: string | null;
  lineGroupId?: string | null;
  title?: string | null;
  metadata?: Record<string, unknown>;
};

export async function upsertConversation(
  db: VelioraDb,
  input: UpsertConversationInput
): Promise<{ id: string }> {
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM ${VERIORA_TABLES.conversations}
     WHERE agent_id = $1 AND conversation_key = $2 LIMIT 1`,
    [input.agentId, input.conversationKey]
  );
  if (existing.rows[0]?.id) {
    await db.query(
      `UPDATE ${VERIORA_TABLES.conversations}
       SET last_message_at = now(), updated_at = now()
       WHERE id = $1`,
      [existing.rows[0].id]
    );
    return { id: existing.rows[0].id };
  }

  const ins = await db.query<{ id: string }>(
    `INSERT INTO ${VERIORA_TABLES.conversations} (
      agent_id, source, line_user_id, line_group_id, conversation_key,
      title, metadata, last_message_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb, now())
    RETURNING id`,
    [
      input.agentId,
      input.source,
      input.lineUserId ?? null,
      input.lineGroupId ?? null,
      input.conversationKey,
      input.title ?? null,
      JSON.stringify(input.metadata ?? {}),
    ]
  );
  const id = ins.rows[0]?.id;
  if (!id) throw new Error("upsertConversation: insert failed");
  return { id };
}
