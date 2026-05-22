import type { VerioraDb } from "../client.js";
import { VERIORA_TABLES } from "../schema.js";

export async function linkConversationToCustomer(
  db: VerioraDb,
  input: {
    customerId: string;
    conversationId: string;
    agentKey?: string;
    linkReason?: string;
    confidence?: number;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO ${VERIORA_TABLES.customerConversationLinks} (
      customer_id, conversation_id, agent_key, link_reason, confidence
    ) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (customer_id, conversation_id) DO NOTHING`,
    [
      input.customerId,
      input.conversationId,
      input.agentKey ?? null,
      input.linkReason ?? "auto",
      input.confidence ?? 1,
    ]
  );
  await db.query(
    `UPDATE ${VERIORA_TABLES.conversations}
     SET customer_id = $2, updated_at = now()
     WHERE id = $1 AND customer_id IS NULL`,
    [input.conversationId, input.customerId]
  );
}

export async function listConversationIdsForCustomer(
  db: VerioraDb,
  customerId: string
): Promise<string[]> {
  const r = await db.query<{ conversation_id: string }>(
    `SELECT conversation_id FROM ${VERIORA_TABLES.customerConversationLinks}
     WHERE customer_id = $1`,
    [customerId]
  );
  return r.rows.map((x) => x.conversation_id);
}
