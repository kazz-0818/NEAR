import type { VelioraDb } from "../client.js";
import { VERIORA_TABLES } from "../schema.js";

export type MergeCandidateRow = {
  id: string;
  customer_id_a: string;
  customer_id_b: string;
  reason: string | null;
  score: number | null;
  status: string;
  created_at: string;
};

export async function createMergeCandidate(
  db: VelioraDb,
  input: {
    customerIdA: string;
    customerIdB: string;
    reason?: string;
    score?: number;
    metadata?: Record<string, unknown>;
  }
): Promise<{ id: string } | null> {
  const a = input.customerIdA < input.customerIdB ? input.customerIdA : input.customerIdB;
  const b = input.customerIdA < input.customerIdB ? input.customerIdB : input.customerIdA;
  if (a === b) return null;
  const r = await db.query<{ id: string }>(
    `INSERT INTO ${VERIORA_TABLES.customerMergeCandidates} (
      customer_id_a, customer_id_b, reason, score, status, metadata
    )
    SELECT $1,$2,$3,$4,'pending',$5::jsonb
    WHERE NOT EXISTS (
      SELECT 1 FROM ${VERIORA_TABLES.customerMergeCandidates}
      WHERE customer_id_a = $1 AND customer_id_b = $2 AND status = 'pending'
    )
    RETURNING id`,
    [a, b, input.reason ?? null, input.score ?? null, JSON.stringify(input.metadata ?? {})]
  );
  return r.rows[0] ? { id: r.rows[0].id } : null;
}

export async function listMergeCandidates(
  db: VelioraDb,
  status = "pending"
): Promise<MergeCandidateRow[]> {
  const r = await db.query<MergeCandidateRow>(
    `SELECT id, customer_id_a, customer_id_b, reason, score, status, created_at
     FROM ${VERIORA_TABLES.customerMergeCandidates}
     WHERE status = $1
     ORDER BY created_at DESC
     LIMIT 200`,
    [status]
  );
  return r.rows;
}

export async function markMergeCandidateStatus(
  db: VelioraDb,
  id: string,
  status: string
): Promise<void> {
  await db.query(
    `UPDATE ${VERIORA_TABLES.customerMergeCandidates}
     SET status = $2, updated_at = now() WHERE id = $1`,
    [id, status]
  );
}
