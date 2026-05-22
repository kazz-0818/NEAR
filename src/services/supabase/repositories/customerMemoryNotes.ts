import type { VerioraDb } from "../client.js";
import { VERIORA_TABLES } from "../schema.js";
import type { CreateMemoryNoteInput, CustomerMemoryNoteRow } from "../../customers/types.js";

export async function createCustomerMemoryNote(
  db: VerioraDb,
  input: CreateMemoryNoteInput
): Promise<{ id: string }> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO ${VERIORA_TABLES.customerMemoryNotes} (
      customer_id, note, category, source_agent_key,
      source_conversation_id, source_message_id,
      importance, confidence, confirmed
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    RETURNING id`,
    [
      input.customerId,
      input.note,
      input.category ?? null,
      input.sourceAgentKey ?? null,
      input.sourceConversationId ?? null,
      input.sourceMessageId ?? null,
      input.importance ?? "medium",
      input.confidence ?? 0.5,
      input.confirmed ?? false,
    ]
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error("createCustomerMemoryNote: insert failed");
  return { id };
}

export async function listCustomerMemoryNotes(
  db: VerioraDb,
  customerId: string,
  opts?: { limit?: number; confirmedOnly?: boolean }
): Promise<CustomerMemoryNoteRow[]> {
  const params: unknown[] = [customerId];
  let sql = `SELECT id, customer_id, note, category, source_agent_key, importance, confidence, confirmed
             FROM ${VERIORA_TABLES.customerMemoryNotes}
             WHERE customer_id = $1`;
  if (opts?.confirmedOnly) sql += ` AND confirmed = true`;
  sql += ` ORDER BY
    CASE importance WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
    confidence DESC, created_at DESC`;
  if (opts?.limit) {
    params.push(opts.limit);
    sql += ` LIMIT $${params.length}`;
  }
  const r = await db.query<CustomerMemoryNoteRow>(sql, params);
  return r.rows;
}
