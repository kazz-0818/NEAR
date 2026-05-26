import type { VelioraDb } from "../client.js";
import { VELIORA_TABLES } from "../schema.js";
import type { CreateMemoryNoteInput, CustomerMemoryNoteRow } from "../../customers/types.js";

export async function createCustomerMemoryNote(
  db: VelioraDb,
  input: CreateMemoryNoteInput
): Promise<{ id: string }> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO ${VELIORA_TABLES.customerMemoryNotes} (
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
  db: VelioraDb,
  customerId: string,
  opts?: { limit?: number; confirmedOnly?: boolean }
): Promise<CustomerMemoryNoteRow[]> {
  const params: unknown[] = [customerId];
  let sql = `SELECT id, customer_id, note, category, source_agent_key, importance, confidence, confirmed
             FROM ${VELIORA_TABLES.customerMemoryNotes}
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

export async function getCustomerMemoryNoteById(
  db: VelioraDb,
  noteId: string
): Promise<(CustomerMemoryNoteRow & { created_at: string }) | null> {
  const r = await db.query<CustomerMemoryNoteRow & { created_at: string }>(
    `SELECT id, customer_id, note, category, source_agent_key, importance, confidence, confirmed, created_at
     FROM ${VELIORA_TABLES.customerMemoryNotes} WHERE id = $1`,
    [noteId]
  );
  return r.rows[0] ?? null;
}

export async function patchCustomerMemoryNote(
  db: VelioraDb,
  noteId: string,
  patch: { note?: string; category?: string | null; confirmed?: boolean; importance?: string }
): Promise<boolean> {
  const sets: string[] = [];
  const params: unknown[] = [noteId];
  if (patch.note !== undefined) {
    params.push(patch.note);
    sets.push(`note = $${params.length}`);
  }
  if (patch.category !== undefined) {
    params.push(patch.category);
    sets.push(`category = $${params.length}`);
  }
  if (patch.confirmed !== undefined) {
    params.push(patch.confirmed);
    sets.push(`confirmed = $${params.length}`);
  }
  if (patch.importance !== undefined) {
    params.push(patch.importance);
    sets.push(`importance = $${params.length}`);
  }
  if (!sets.length) return false;
  sets.push("updated_at = now()");
  const r = await db.query(
    `UPDATE ${VELIORA_TABLES.customerMemoryNotes} SET ${sets.join(", ")} WHERE id = $1`,
    params
  );
  return (r.rowCount ?? 0) > 0;
}

/** 管理 API 用・単一行のみ */
export async function deleteCustomerMemoryNote(db: VelioraDb, noteId: string): Promise<boolean> {
  const r = await db.query(`DELETE FROM ${VELIORA_TABLES.customerMemoryNotes} WHERE id = $1`, [noteId]);
  return (r.rowCount ?? 0) > 0;
}
